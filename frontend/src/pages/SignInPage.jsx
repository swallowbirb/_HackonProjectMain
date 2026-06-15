import { SignIn } from '@clerk/clerk-react';
import { useLocation } from 'react-router-dom';

export default function SignInPage() {
  const location = useLocation();
  const from = location.state?.from || '/';

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-80px)] p-4 bg-background">
      <SignIn 
        routing="path" 
        path="/sign-in" 
        signUpUrl="/sign-up"
        forceRedirectUrl={from}
      />
    </div>
  );
}
