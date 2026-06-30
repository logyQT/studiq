'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api';
import { useRouter } from 'next/navigation';

export function useCreateClassroom() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (data: { name: string; slug?: string }) => {
      return apiPost<{ id: string; name: string; slug: string }>('/api/v1/teacher/classrooms', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
      router.push('/edu');
    },
  });
}
