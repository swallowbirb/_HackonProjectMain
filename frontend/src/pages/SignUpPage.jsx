import { SignUp } from '@clerk/clerk-react';

export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-80px)] p-4 bg-background">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/role-selection"
        fallbackRedirectUrl="/role-selection"
      />
    </div>
  );
}
