"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn, Mail, Shield } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required")
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  async function onSubmit(values: LoginValues) {
    setIsSubmitting(true);
    const response = await fetch("/api/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    setIsSubmitting(false);

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      toast.error(payload.error || "Unable to sign in");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="p-6">
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground">Welcome back</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h2>
        </div>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="email" autoComplete="email" className="pl-9" {...form.register("email")} />
            </div>
            {form.formState.errors.email ? (
              <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Shield className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="password" type="password" autoComplete="current-password" className="pl-9" {...form.register("password")} />
            </div>
            {form.formState.errors.password ? (
              <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
            ) : null}
          </div>
          <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
