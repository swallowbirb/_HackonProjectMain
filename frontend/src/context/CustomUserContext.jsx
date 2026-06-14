import { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { setAuthToken } from "../services/api";

const CustomUserContext = createContext();

export function CustomUserProvider({ children }) {
  const { getToken, isSignedIn: clerkIsSignedIn, isLoaded: clerkIsLoaded } = useAuth();
  const [role, setRole] = useState(null);
  const [mongoUser, setMongoUser] = useState(null);
  const [isLoadingRole, setIsLoadingRole] = useState(true);

  const isDev = process.env.NODE_ENV !== "production" || import.meta.env?.DEV;
  const [mockClerkId, setMockClerkId] = useState(isDev ? localStorage.getItem("mock_clerk_id") : null);

  const isSignedIn = !!mockClerkId || clerkIsSignedIn;
  const isLoaded = clerkIsLoaded;

  const fetchMongoUser = async () => {
    setIsLoadingRole(true);
    const activeId = isDev ? localStorage.getItem("mock_clerk_id") : null;

    if (!clerkIsSignedIn && !activeId) {
      setRole(null);
      setMongoUser(null);
      setAuthToken(null);
      setIsLoadingRole(false);
      return;
    }

    try {
      const token = activeId ? activeId : await getToken();
      setAuthToken(token);
      
      // First, try to sync user to make sure they exist in Mongo
      await fetch(`${import.meta.env.VITE_API_URL}/users/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      // Then get the user profile
      const response = await fetch(`${import.meta.env.VITE_API_URL}/users/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setMongoUser(data.data);
        setRole(data.data.role);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
    } finally {
      setIsLoadingRole(false);
    }
  };

  useEffect(() => {
    if (clerkIsLoaded) {
      fetchMongoUser();
    }
  }, [clerkIsLoaded, clerkIsSignedIn, mockClerkId]);

  const updateRole = async (newRole) => {
    try {
      const token = mockClerkId ? mockClerkId : await getToken();
      const response = await fetch(`${import.meta.env.VITE_API_URL}/users/role`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });

      if (response.ok) {
        const data = await response.json();
        setMongoUser(data.data);
        setRole(data.data.role);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error updating role:", error);
      return false;
    }
  };

  return (
    <CustomUserContext.Provider value={{ role, mongoUser, updateRole, isLoadingRole, isSignedIn, isLoaded }}>
      {children}
    </CustomUserContext.Provider>
  );
}

export function useCustomUser() {
  return useContext(CustomUserContext);
}

export function CustomSignedIn({ children }) {
  const { isSignedIn, isLoadingRole } = useCustomUser();
  if (isLoadingRole) return null;
  return isSignedIn ? <>{children}</> : null;
}

export function CustomSignedOut({ children }) {
  const { isSignedIn, isLoadingRole } = useCustomUser();
  if (isLoadingRole) return null;
  return !isSignedIn ? <>{children}</> : null;
}
