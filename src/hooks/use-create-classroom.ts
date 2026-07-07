'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

export function useCreateClassroom() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (data: { name: string }) => {
      return apiPost<{ id: string; name: string }>('/api/v1/teacher/classrooms', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
      router.push('/edu');
    },
  });
}
