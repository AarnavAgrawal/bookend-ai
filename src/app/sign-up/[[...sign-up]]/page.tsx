import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { clerkEnabled } from "@/platform/auth";

export default function SignUpPage() {
  if (!clerkEnabled()) redirect("/");
  return (
    <div className="flex justify-center py-16">
      <SignUp />
    </div>
  );
}
