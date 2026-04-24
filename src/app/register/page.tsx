"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RegisterSchema, type RegisterInput } from "@/server/models/user.model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Mail, Lock, User, UserPlus } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("RegisterPage");

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    mode: "onBlur",
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: RegisterInput) {
    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) throw new Error();

      toast.success("Konto zostało utworzone!");
      router.push("/dashboard");
    } catch {
      toast.error("Wystąpił błąd podczas rejestracji");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <div className="w-full max-w-md space-y-8 bg-background p-8 rounded-xl shadow-lg border">
        {/* HEADER */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("header")}</h1>
          <p className="text-sm text-muted-foreground">{t("sub_header")}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* IMIĘ + NAZWISKO */}
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t("name_label")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder={t("name_placeholder")} className={cn("pl-9", fieldState.error && "border-destructive focus-visible:ring-destructive")} {...field} />
                    </div>
                  </FormControl>
                  <FormMessage translator={t} />
                </FormItem>
              )}
            />

            {/* EMAIL */}
            <FormField
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t("email_label")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input placeholder={t("email_placeholder")} className={cn("pl-9", fieldState.error && "border-destructive focus-visible:ring-destructive")} {...field} />
                    </div>
                  </FormControl>
                  <FormMessage translator={t} />
                </FormItem>
              )}
            />

            {/* HASŁO */}
            <FormField
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t("password_label")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="password" placeholder="••••••••" className={cn("pl-9", fieldState.error && "border-destructive focus-visible:ring-destructive")} {...field} />
                    </div>
                  </FormControl>
                  <FormMessage translator={t} />
                </FormItem>
              )}
            />

            {/* SUBMIT */}
            <Button type="submit" className="w-full flex items-center gap-2" disabled={form.formState.isSubmitting}>
              <UserPlus size={18} />
              {form.formState.isSubmitting ? "..." : t("register_button")}
            </Button>
          </form>
        </Form>

        {/* LOGIN LINK */}
        <p className="text-center text-sm text-muted-foreground">
          {t("have_account")}{" "}
          <Link href="/login" className="text-primary hover:underline">
            {t("login_link")}
          </Link>
        </p>
      </div>
    </div>
  );
}
