'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@/lib/zod';
import { Copy, PlusCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CreateUniversitySchema } from '@/server/models/university.model';
import { CreateInviteSchema } from '@/server/models/invitation.model';
import { UserRole } from '@/types';
import { AppError, AppErrorCode } from '@/lib/errors';

export default function SysAdminDashboard() {
  const [createdUniversityId, setCreatedUniversityId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const formUniversity = useForm<z.infer<typeof CreateUniversitySchema>>({
    resolver: zodResolver(CreateUniversitySchema),
    defaultValues: { name: '', slug: '' },
  });

  const formInvite = useForm<z.infer<typeof CreateInviteSchema>>({
    resolver: zodResolver(CreateInviteSchema),
    defaultValues: { email: '', role: UserRole.UNIVERSITY_ADMIN, universityId: undefined },
  });

  async function onSubmitUniversity(values: z.infer<typeof CreateUniversitySchema>) {
    try {
      const res = await fetch('/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        if (res.status == 409) throw new AppError(AppErrorCode.SLUG_ALREADY_EXISTS, 409);
        throw new AppError(AppErrorCode.INTERNAL_SERVER, res.status);
      }

      const data = await res.json();
      setCreatedUniversityId(data.id);

      toast.success('Sukces!', { description: `Uczelnia utworzona. ID: ${data.id}` });

      formInvite.setValue('universityId', data.id);
      formUniversity.reset();
    } catch (error: unknown) {
      if (error instanceof AppError) {
        toast.error('Błąd', { description: error.message });
      } else {
        toast.error('Nieznany błąd', { description: 'Wystąpił nieznany błąd' });
      }
    }
  }

  async function onSubmitInvite(values: z.infer<typeof CreateInviteSchema>) {
    setInviteLink(null);
    try {
      const payload = {
        ...values,
        universityId: values.universityId === '' ? undefined : values.universityId,
      };

      const res = await fetch('/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Nie udało się wysłać zaproszenia');

      const data = await res.json();
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
      }

      toast.success('Wysłano!', { description: 'Zaproszenie zostało pomyślnie wygenerowane.' });
      formInvite.reset({
        name: '',
        email: '',
        role: UserRole.UNIVERSITY_ADMIN,
        universityId: payload.universityId,
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        toast.error('Błąd', { description: error.message });
      } else {
        toast.error('Nieznany błąd', { description: 'Wystąpił nieznany błąd' });
      }
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Panel Głównego Administratora</h1>
        <p className="text-muted-foreground mt-2">
          Zarządzaj uczelniami i nadawaj najwyższe uprawnienia.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="w-5 h-5" /> Dodaj Uczelnię
            </CardTitle>
            <CardDescription>Zarejestruj nowy podmiot w systemie StudiQ.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...formUniversity}>
              <form
                onSubmit={formUniversity.handleSubmit(onSubmitUniversity)}
                className="space-y-4"
              >
                <FormField
                  control={formUniversity.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pełna nazwa</FormLabel>
                      <FormControl>
                        <Input placeholder="np. Politechnika Wrocławska" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formUniversity.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug (identyfikator URL)</FormLabel>
                      <FormControl>
                        <Input placeholder="np. pwr" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full">
                  Zarejestruj uczelnię
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" /> Wyślij Zaproszenie
            </CardTitle>
            <CardDescription>Zaproś administratora lub innych użytkowników.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...formInvite}>
              <form onSubmit={formInvite.handleSubmit(onSubmitInvite)} className="space-y-4">
                <FormField
                  control={formInvite.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Imię i nazwisko</FormLabel>
                      <FormControl>
                        <Input placeholder="np. Jan Kowalski" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formInvite.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Adres e-mail</FormLabel>
                      <FormControl>
                        <Input placeholder="rektor@uczelnia.pl" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formInvite.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rola</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Wybierz rolę" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={UserRole.UNIVERSITY_ADMIN}>
                            Administrator Uczelni
                          </SelectItem>
                          <SelectItem value={UserRole.TEACHER}>Wykładowca</SelectItem>
                          <SelectItem value={UserRole.STUDENT}>Student</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formInvite.control}
                  name="universityId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ID Uczelni (UUID)</FormLabel>
                      <FormControl>
                        <Input placeholder="UUID uczelni" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" variant="secondary">
                  Generuj zaproszenie
                </Button>
              </form>
            </Form>

            {inviteLink && (
              <div className="mt-6 p-4 bg-muted rounded-md border border-border">
                <p className="text-sm font-medium mb-2">Link z zaproszeniem (Tryb Dev):</p>
                <div className="flex gap-2">
                  <Input readOnly value={inviteLink} className="text-xs font-mono" />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink);
                      toast.success('Skopiowano!', { description: 'Link skopiowany do schowka!' });
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
