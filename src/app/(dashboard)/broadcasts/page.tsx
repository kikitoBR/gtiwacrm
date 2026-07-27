'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BroadcastsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/inbox');
  }, [router]);

  return null;
}
