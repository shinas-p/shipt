import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured, validateSupabaseConfig } from "@/lib/supabase";
import { toast } from "sonner";

export interface CustomerProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
  default_hostel: string | null;
  default_block: string | null;
  default_room: string | null;
  avatar_url?: string | null;
}

export interface CustomerOrderItem {
  id: string;
  product_id?: string | null;
  product_name: string;
  product_size: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  image_url?: string | null;
  products?: {
    image_url?: string | null;
  } | null;
}

export interface CustomerOrderStatusHistory {
  id: string;
  previous_status?: string | null;
  new_status: string;
  notes?: string | null;
  created_at: string;
}

export interface CustomerOrderSummary {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  subtotal: number;
  delivery_fee: number;
  discount_amount?: number;
  delivery_method: string;
  hostel?: string | null;
  block?: string | null;
  room?: string | null;
  pickup_location?: string | null;
  delivery_instructions?: string | null;
  payment_method: string;
  payment_status: string;
  created_at: string;
  order_items: CustomerOrderItem[];
  order_status_history?: CustomerOrderStatusHistory[];
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: CustomerProfile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (
    email: string,
    password: string,
    profileData?: {
      full_name?: string;
      phone?: string;
      default_hostel?: string;
      default_block?: string;
      default_room?: string;
    }
  ) => Promise<{ success: boolean; requiresEmailConfirmation?: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  updateProfile: (data: Partial<CustomerProfile>) => Promise<{ success: boolean; error?: string }>;
  refreshProfile: () => Promise<void>;
  fetchCustomerOrders: () => Promise<CustomerOrderSummary[]>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, default_hostel, default_block, default_room, avatar_url")
        .eq("id", userId)
        .maybeSingle();

      if (!error && data) {
        setProfile(data as CustomerProfile);
      } else if (!data && !error) {
        // Safe profile synchronization: create empty profile if missing
        const { data: newProf } = await supabase
          .from("profiles")
          .upsert({ id: userId }, { onConflict: "id" })
          .select("id, full_name, phone, default_hostel, default_block, default_room, avatar_url")
          .maybeSingle();
        if (newProf) {
          setProfile(newProf as CustomerProfile);
        }
      }
    } catch {
      // Graceful fallback if profile cannot be fetched
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function initSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (isMounted) {
          setSession(data.session);
          setUser(data.session?.user ?? null);
          if (data.session?.user) {
            await fetchProfile(data.session.user.id);
          }
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    initSession();

    // Ensure staff invitation or password recovery tokens route immediately to /account password setup
    if (typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const isStaffInviteOrRecovery =
        hash.includes("type=invite") ||
        hash.includes("type=recovery") ||
        search.includes("type=invite") ||
        search.includes("type=recovery");

      if (isStaffInviteOrRecovery && window.location.pathname !== "/account") {
        window.location.replace(`/account?tab=profile&setup_password=true${hash}`);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        await fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
      }

      // If user arrived via a password recovery or staff invite link, ensure they are on the password setup card
      if (
        (event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") &&
        typeof window !== "undefined" &&
        window.location.pathname !== "/account"
      ) {
        window.location.replace("/account?tab=profile&setup_password=true");
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      const { missing } = validateSupabaseConfig();
      return {
        success: false,
        error: `Supabase authentication is not configured in this environment (missing ${missing.join(", ")}). Please add these variables in your Vercel Project Settings.`,
      };
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      setUser(data.user);
      setSession(data.session);
      if (data.user) {
        await fetchProfile(data.user.id);
      }
      toast.success("Welcome back to Shipt!");
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to sign in." };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    profileData?: {
      full_name?: string;
      phone?: string;
      default_hostel?: string;
      default_block?: string;
      default_room?: string;
    }
  ) => {
    if (!isSupabaseConfigured) {
      const { missing } = validateSupabaseConfig();
      return {
        success: false,
        error: `Supabase authentication is not configured in this environment (missing ${missing.join(", ")}). Please add these variables in your Vercel Project Settings.`,
      };
    }

    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: profileData?.full_name?.trim() || "",
            phone: profileData?.phone?.trim() || "",
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Supabase anti-enumeration: if email confirmation is enabled and user exists,
      // data.user exists but identities array is empty
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return {
          success: false,
          error: "An account with this email address already exists. Please sign in or reset your password.",
        };
      }

      if (data.session) {
        setUser(data.user);
        setSession(data.session);

        // Safe profile synchronization for delivery details
        if (data.user && profileData) {
          try {
            await supabase
              .from("profiles")
              .upsert({
                id: data.user.id,
                full_name: profileData.full_name?.trim() || null,
                phone: profileData.phone?.trim() || null,
                default_hostel: profileData.default_hostel || null,
                default_block: profileData.default_block || null,
                default_room: profileData.default_room || null,
              }, { onConflict: "id" });
          } catch {
            // Non-blocking
          }
          await fetchProfile(data.user.id);
        }
        toast.success("Welcome to Shipt! Account created successfully.");
        return { success: true, requiresEmailConfirmation: false };
      } else if (data.user) {
        // User created, but email confirmation is required by Supabase Auth policy
        // Crucial: Clear local unauthenticated session state
        setUser(null);
        setSession(null);
        toast.success("Account created! Please check your email to confirm your account before signing in.", {
          duration: 6000,
        });
        return { success: true, requiresEmailConfirmation: true };
      }

      return { success: false, error: "Unable to complete registration. Please try again." };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to create account." };
    }
  };

  const signOut = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
      setUser(null);
      setSession(null);
      setProfile(null);
      toast("You have been signed out.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to sign out.");
    }
  };

  const resetPassword = async (email: string) => {
    if (!isSupabaseConfigured) {
      const { missing } = validateSupabaseConfig();
      return {
        success: false,
        error: `Supabase authentication is not configured in this environment (missing ${missing.join(", ")}). Please add these variables in your Vercel Project Settings.`,
      };
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/account`,
      });
      if (error) {
        return { success: false, error: error.message };
      }
      toast.success("Password reset instructions sent to your email.");
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to request password reset." };
    }
  };

  const updatePassword = async (newPassword: string) => {
    if (!isSupabaseConfigured) {
      return { success: false, error: "Supabase authentication is not configured in this environment." };
    }
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: "Password must be at least 6 characters long." };
    }
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { success: false, error: error.message };
      }
      toast.success("Password updated successfully.");
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to update password." };
    }
  };

  const updateProfile = async (data: Partial<CustomerProfile>) => {
    if (!user) {
      return { success: false, error: "You must be signed in to update your profile." };
    }
    try {
      const updatePayload: {
        id: string;
        full_name?: string | null;
        phone?: string | null;
        default_hostel?: string | null;
        default_block?: string | null;
        default_room?: string | null;
      } = {
        id: user.id,
      };
      if (data.full_name !== undefined) updatePayload.full_name = data.full_name;
      else if (profile?.full_name !== undefined) updatePayload.full_name = profile.full_name;

      if (data.phone !== undefined) updatePayload.phone = data.phone;
      else if (profile?.phone !== undefined) updatePayload.phone = profile.phone;

      if (data.default_hostel !== undefined) updatePayload.default_hostel = data.default_hostel;
      else if (profile?.default_hostel !== undefined) updatePayload.default_hostel = profile.default_hostel;

      if (data.default_block !== undefined) updatePayload.default_block = data.default_block;
      else if (profile?.default_block !== undefined) updatePayload.default_block = profile.default_block;

      if (data.default_room !== undefined) updatePayload.default_room = data.default_room;
      else if (profile?.default_room !== undefined) updatePayload.default_room = profile.default_room;

      const { error } = await supabase
        .from("profiles")
        .upsert(updatePayload, { onConflict: "id" });

      if (error) {
        return { success: false, error: error.message };
      }

      await fetchProfile(user.id);
      toast.success("Delivery details saved!");
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || "Failed to update profile." };
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const fetchCustomerOrders = async (): Promise<CustomerOrderSummary[]> => {
    if (!user || !isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          total_amount,
          subtotal,
          delivery_fee,
          discount_amount,
          delivery_method,
          hostel,
          block,
          room,
          pickup_location,
          delivery_instructions,
          payment_method,
          payment_status,
          created_at,
          order_items (
            id,
            product_id,
            product_name,
            product_size,
            unit_price,
            quantity,
            total_price,
            products (
              image_url
            )
          ),
          order_status_history (
            id,
            previous_status,
            new_status,
            notes,
            created_at
          )
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error || !data) return [];
      return data as unknown as CustomerOrderSummary[];
    } catch {
      return [];
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isLoading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        updateProfile,
        refreshProfile,
        fetchCustomerOrders,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useCustomerAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useCustomerAuth must be used within an AuthProvider");
  }
  return context;
}
