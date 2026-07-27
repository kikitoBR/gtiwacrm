"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
}

export function PipelineAnalytics({ deals }: PipelineAnalyticsProps) {
  const stats = useMemo(() => {
    const totalCount = deals.length;
    const openCount = deals.filter((d) => d.status === "open").length;
    const wonCount = deals.filter((d) => d.status === "won").length;
    const lostCount = deals.filter((d) => d.status === "lost").length;

    return {
      totalCount,
      openCount,
      wonCount,
      lostCount,
    };
  }, [deals]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-4">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label="Total de Demandas"
          value={String(stats.totalCount)}
          tooltip="Quantidade total de demandas cadastradas no quadro"
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label="Em Andamento"
          value={String(stats.openCount)}
          tooltip="Demandas ativas em progresso"
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label="Concluídos"
          value={String(stats.wonCount)}
          tooltip="Demandas concluídas com sucesso"
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label="Cancelados"
          value={String(stats.lostCount)}
          tooltip="Demandas canceladas ou arquivadas"
        />
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Informações sobre ${label}`}
                className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
