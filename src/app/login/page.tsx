// src/app/(auth)/login/page.tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginSchema, type LoginInput } from "@/server/models/user.model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl"; //

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("LoginPage"); //

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginInput) {
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) throw new Error("Błędne dane logowania");

      toast.success("Zalogowano pomyślnie!");
      router.push("/dashboard");
    } catch (error) {
      toast.error("Wystąpił błąd podczas logowania");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <div className="w-full max-w-md space-y-8 bg-background p-8 rounded-xl shadow-lg border">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("header")}</h1>
          <p className="text-sm text-muted-foreground">{t("sub_header")}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={(
                { field, fieldState }, // Dodajemy fieldState
              ) => (
                <FormItem>
                  <FormLabel>{t("email_label")}</FormLabel>
                  <FormControl>
                    <Input placeholder="twoj@email.com" {...field} />
                  </FormControl>
                  <FormMessage>
                    {/* {t("ERROR_EMAIL_INVALID")} */}
                    {/* KLUCZOWE: Jeśli jest błąd, szukamy tłumaczenia dla klucza zwróconego przez Zod */}
                    {fieldState.error?.message && t(`${fieldState.error.message}`)}
                  </FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={(
                { field, fieldState }, // Dodajemy fieldState
              ) => (
                <FormItem>
                  <FormLabel>{t("password_label")}</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage>
                    {/* KLUCZOWE: Mapowanie klucza błędu na tłumaczenie */}
                    {fieldState.error?.message && t(fieldState.error.message)}
                  </FormMessage>
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "..." : t("login_button")}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
