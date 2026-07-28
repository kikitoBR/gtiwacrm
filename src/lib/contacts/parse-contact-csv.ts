/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 * Supports standard CSV format as well as Google Contacts / Gmail / Android CSV exports.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  const parts = value.split(/:::|[,;]/);
  for (const part of parts) {
    const name = part.trim().replace(/^[*@\s]+/, '');
    if (!name) continue;

    // Ignore internal Google Contacts metadata labels
    const lower = name.toLowerCase();
    if (
      lower === 'mycontacts' ||
      lower === 'other' ||
      lower === 'work' ||
      lower.startsWith('importado em')
    ) {
      continue;
    }

    if (seen.has(lower)) continue;
    seen.add(lower);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const headers = parseCsvLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/["']/g, '')
  );

  // Helper to find index matching exact name or substring aliases
  const findIndexByAliases = (...aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) return idx;
    }
    for (const alias of aliases) {
      const idx = headers.findIndex((h) => h.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const phoneIdx = findIndexByAliases('phone 1 - value', 'phone', 'telefone', 'celular', 'phone 1', 'mobile', 'tel');
  const phone2Idx = findIndexByAliases('phone 2 - value', 'phone 2', 'phone 3 - value');

  const fullNameIdx = findIndexByAliases('name', 'nome', 'nome completo', 'file as', 'formatted name');
  const firstNameIdx = findIndexByAliases('first name', 'nome');
  const middleNameIdx = findIndexByAliases('middle name');
  const lastNameIdx = findIndexByAliases('last name', 'sobrenome');

  const emailIdx = findIndexByAliases('e-mail 1 - value', 'email 1 - value', 'email', 'e-mail', 'mail');
  const companyIdx = findIndexByAliases('organization name', 'company', 'empresa', 'organization', 'org');
  const tagsIdx = findIndexByAliases('labels', 'tags', 'etiquetas', 'grupos', 'groups', 'categories');

  if (phoneIdx === -1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);

    // Primary phone, fallback to secondary phone
    let phone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!phone && phone2Idx >= 0) {
      phone = values[phone2Idx]?.replace(/["']/g, '').trim();
    }
    if (!phone) continue;

    // Resolve name: combine First + Middle + Last or use Full Name
    let name: string | undefined;
    if (firstNameIdx >= 0 || lastNameIdx >= 0) {
      const first = values[firstNameIdx]?.replace(/["']/g, '').trim() || '';
      const middle = middleNameIdx >= 0 ? values[middleNameIdx]?.replace(/["']/g, '').trim() || '' : '';
      const last = lastNameIdx >= 0 ? values[lastNameIdx]?.replace(/["']/g, '').trim() || '' : '';
      const combined = [first, middle, last].filter(Boolean).join(' ');
      if (combined) name = combined;
    }
    if (!name && fullNameIdx >= 0) {
      name = values[fullNameIdx]?.replace(/["']/g, '').trim() || undefined;
    }

    const email = emailIdx >= 0 ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined : undefined;
    const company = companyIdx >= 0 ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined : undefined;
    const tagNames = tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [];

    rows.push({
      phone,
      name: name || undefined,
      email: email || undefined,
      company: company || undefined,
      tagNames,
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0 || firstNameIdx >= 0,
  };
}

/** CSV line parser handling quotes. */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
