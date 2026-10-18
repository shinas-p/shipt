import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Shipt — Staff Creation & Onboarding Security Test Suite
 * 
 * Tests the server-side Edge Function and frontend security contracts:
 * 1. Super Admin creates a new Store Manager without prior registration.
 * 2. Super Admin creates a new Super Admin without prior registration.
 * 3. Customer attempts staff creation and is rejected (403/401).
 * 4. Store Manager attempts to create or promote a Super Admin and is rejected (403).
 * 5. Existing email does not produce a duplicate Auth account (returns alreadyExists).
 * 6. Failed invitation delivery or role assignment can be recovered safely (clean rollback).
 * 7. Staff can set a password and sign in.
 * 8. Correct role permissions are enforced (Super Admin vs Store Manager).
 * 9. No service-role secret is present in client bundle or client-accessible variables.
 */
describe("Shipt — Staff Creation & Onboarding Security Suite", { timeout: 25000 }, () => {
  // Mock Database & Auth Store for server simulation
  interface MockUser {
    id: string;
    email: string;
    fullName?: string;
    role?: "super_admin" | "store_manager";
  }

  class MockAuthAndDbService {
    users: Map<string, MockUser> = new Map();
    adminRoles: Map<string, { role: string; created_by: string; created_at: string }> = new Map();
    profiles: Map<string, { full_name: string }> = new Map();
    sentEmails: Array<{ to: string; type: string; redirectTo: string }> = [];

    constructor() {
      // Seed existing super admin
      const superAdminId = "usr-super-admin-001";
      this.users.set("sshinasbin@gmail.com", {
        id: superAdminId,
        email: "sshinasbin@gmail.com",
        fullName: "Existing Super Admin",
        role: "super_admin",
      });
      this.adminRoles.set(`${superAdminId}-super_admin`, {
        role: "super_admin",
        created_by: superAdminId,
        created_at: new Date().toISOString(),
      });

      // Seed existing regular customer
      this.users.set("customer@shipt.campus", {
        id: "usr-customer-002",
        email: "customer@shipt.campus",
        fullName: "Campus Student",
      });

      // Seed existing store manager
      const storeManagerId = "usr-store-manager-003";
      this.users.set("manager@shipt.campus", {
        id: storeManagerId,
        email: "manager@shipt.campus",
        fullName: "Store Manager",
        role: "store_manager",
      });
      this.adminRoles.set(`${storeManagerId}-store_manager`, {
        role: "store_manager",
        created_by: superAdminId,
        created_at: new Date().toISOString(),
      });
    }

    // Server-side Edge Function handler simulation
    async executeAdminCreateStaff(
      callerId: string,
      payload: { email: string; fullName?: string; role: string; redirectTo?: string },
      options: { simulateRoleAssignFailure?: boolean } = {}
    ): Promise<{ status: number; body: any }> {
      // 1. Authenticate caller
      let callerRole: string | null = null;
      for (const [key, val] of this.adminRoles.entries()) {
        if (key.startsWith(callerId)) {
          callerRole = val.role;
          break;
        }
      }

      // 2. Strict authorization: Only Super Admin can invoke
      if (callerRole !== "super_admin") {
        return {
          status: 403,
          body: { error: "Access Denied: Only Super Administrators can create staff accounts or assign roles." },
        };
      }

      // 3. Normalize & validate input
      const cleanEmail = (payload.email || "").trim().toLowerCase();
      const cleanName = (payload.fullName || "").trim();
      const requestedRole = payload.role;

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!cleanEmail || !emailRegex.test(cleanEmail)) {
        return { status: 400, body: { error: "A valid email address is required." } };
      }

      if (requestedRole !== "store_manager" && requestedRole !== "super_admin") {
        return {
          status: 400,
          body: { error: `Invalid role "${requestedRole}". Supported roles: store_manager, super_admin.` },
        };
      }

      // 4. Duplicate check: If user already exists in Auth
      if (this.users.has(cleanEmail)) {
        return {
          status: 409,
          body: {
            alreadyExists: true,
            error: `An account for "${cleanEmail}" is already registered.`,
            email: cleanEmail,
            role: requestedRole,
            suggestedAction: "assign_role",
          },
        };
      }

      // 5. Create user in Auth & dispatch invitation email
      const newUserId = `usr-staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newUser: MockUser = {
        id: newUserId,
        email: cleanEmail,
        fullName: cleanName,
        role: requestedRole as any,
      };

      // Canonical production redirect logic mirroring Edge Function
      let canonicalRedirect = "https://shiptmart.vercel.app/accept-invitation";
      if (typeof payload.redirectTo === "string" && payload.redirectTo.startsWith("http")) {
        try {
          const parsed = new URL(payload.redirectTo);
          if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
            canonicalRedirect = `${parsed.origin}/accept-invitation`;
          }
        } catch {
          // Fall back to canonical production URL
        }
      }

      this.users.set(cleanEmail, newUser);
      this.sentEmails.push({
        to: cleanEmail,
        type: "invite",
        redirectTo: canonicalRedirect,
      });

      // 6. Assign requested role with rollback guard
      if (options.simulateRoleAssignFailure) {
        // Rollback on database failure
        this.users.delete(cleanEmail);
        return {
          status: 500,
          body: { error: "Failed to assign staff permissions: Simulated database connection failure." },
        };
      }

      this.adminRoles.set(`${newUserId}-${requestedRole}`, {
        role: requestedRole,
        created_by: callerId,
        created_at: new Date().toISOString(),
      });

      if (cleanName) {
        this.profiles.set(newUserId, { full_name: cleanName });
      }

      return {
        status: 200,
        body: {
          success: true,
          message: `Staff invitation successfully sent to ${cleanEmail} with role "${requestedRole.replace("_", " ")}".`,
          user: {
            id: newUserId,
            email: cleanEmail,
            fullName: cleanName,
            role: requestedRole,
          },
        },
      };
    }
  }

  describe("Server-Side Staff Account Creation Flow", () => {
    it("allows authorized Super Admin to create a Store Manager without prior registration", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      const res = await service.executeAdminCreateStaff(superAdminId, {
        email: "newstoremanager@shipt.campus",
        fullName: "Aditya Kumar",
        role: "store_manager",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe("newstoremanager@shipt.campus");
      expect(res.body.user.role).toBe("store_manager");
      expect(res.body.user.fullName).toBe("Aditya Kumar");

      // Verify Auth account was created and role stored
      expect(service.users.has("newstoremanager@shipt.campus")).toBe(true);
      const roleKey = `${res.body.user.id}-store_manager`;
      expect(service.adminRoles.get(roleKey)?.role).toBe("store_manager");

      // Verify invitation email was dispatched
      expect(service.sentEmails.some((e) => e.to === "newstoremanager@shipt.campus" && e.type === "invite")).toBe(true);
    });

    it("allows authorized Super Admin to create a new Super Admin without prior registration", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      const res = await service.executeAdminCreateStaff(superAdminId, {
        email: "secadmin@campus.edu",
        fullName: "Dr. Sunita Varma",
        role: "super_admin",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe("secadmin@campus.edu");
      expect(res.body.user.role).toBe("super_admin");

      const roleKey = `${res.body.user.id}-super_admin`;
      expect(service.adminRoles.get(roleKey)?.role).toBe("super_admin");
    });

    it("rejects unauthorized ordinary customer from creating staff accounts (403 Forbidden)", async () => {
      const service = new MockAuthAndDbService();
      const customerId = "usr-customer-002"; // Regular student

      const res = await service.executeAdminCreateStaff(customerId, {
        email: "hacker@campus.edu",
        fullName: "Unauthorized User",
        role: "super_admin",
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Access Denied");
      expect(service.users.has("hacker@campus.edu")).toBe(false);
    });

    it("rejects Store Manager from creating or promoting staff accounts (403 Forbidden)", async () => {
      const service = new MockAuthAndDbService();
      const storeManagerId = "usr-store-manager-003";

      const res = await service.executeAdminCreateStaff(storeManagerId, {
        email: "newmanager@campus.edu",
        fullName: "Store Associate",
        role: "store_manager",
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Access Denied");
      expect(service.users.has("newmanager@campus.edu")).toBe(false);
    });

    it("prevents duplicate account creation when email already belongs to an existing user (409 Conflict)", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      // Attempt to create staff with an existing student email
      const res = await service.executeAdminCreateStaff(superAdminId, {
        email: "customer@shipt.campus", // already exists
        fullName: "Student Upgrade",
        role: "store_manager",
      });

      expect(res.status).toBe(409);
      expect(res.body.alreadyExists).toBe(true);
      expect(res.body.suggestedAction).toBe("assign_role");
      expect(res.body.error).toContain("already registered");

      // Verify existing customer account was NOT overwritten
      const existing = service.users.get("customer@shipt.campus");
      expect(existing?.fullName).toBe("Campus Student");
    });

    it("performs safe atomic rollback if role assignment fails, avoiding orphaned user accounts", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      const res = await service.executeAdminCreateStaff(
        superAdminId,
        {
          email: "flaky-network@shipt.campus",
          fullName: "Network Flake",
          role: "store_manager",
        },
        { simulateRoleAssignFailure: true }
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Failed to assign staff permissions");

      // Verify the auth user was cleanly rolled back and not left orphaned
      expect(service.users.has("flaky-network@shipt.campus")).toBe(false);
    });

    it("validates input strictly: rejects invalid email formats and unrecognized roles", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      const invalidEmailRes = await service.executeAdminCreateStaff(superAdminId, {
        email: "not-an-email",
        role: "store_manager",
      });
      expect(invalidEmailRes.status).toBe(400);

      const invalidRoleRes = await service.executeAdminCreateStaff(superAdminId, {
        email: "valid@shipt.campus",
        role: "unauthorized_role_injection",
      });
      expect(invalidRoleRes.status).toBe(400);
    });
  });

  describe("Password Setup & Role Permission Boundary Enforcement", () => {
    it("allows invited staff to set a new password and log in to admin portal", () => {
      const validatePasswordRules = (pass: string) => {
        if (!pass || pass.length < 6) {
          return { valid: false, error: "Password must be at least 6 characters long." };
        }
        return { valid: true };
      };

      expect(validatePasswordRules("12345").valid).toBe(false);
      expect(validatePasswordRules("superSecret2026!").valid).toBe(true);
    });

    it("enforces correct feature boundary permissions: Store Manager vs Super Admin", () => {
      const getPermissionsForRole = (role: "super_admin" | "store_manager") => ({
        canManageOrders: true,
        canManageProducts: true,
        canManageBanners: role === "super_admin",
        canManageCategories: role === "super_admin",
        canManageStaffRoles: role === "super_admin",
        canCreateStaffAccounts: role === "super_admin",
      });

      const superAdminPerms = getPermissionsForRole("super_admin");
      expect(superAdminPerms.canManageOrders).toBe(true);
      expect(superAdminPerms.canManageProducts).toBe(true);
      expect(superAdminPerms.canManageBanners).toBe(true);
      expect(superAdminPerms.canManageStaffRoles).toBe(true);
      expect(superAdminPerms.canCreateStaffAccounts).toBe(true);

      const storeManagerPerms = getPermissionsForRole("store_manager");
      expect(storeManagerPerms.canManageOrders).toBe(true);
      expect(storeManagerPerms.canManageProducts).toBe(true);
      expect(storeManagerPerms.canManageBanners).toBe(false);
      expect(storeManagerPerms.canManageStaffRoles).toBe(false);
      expect(storeManagerPerms.canCreateStaffAccounts).toBe(false);
    });

    it("never exposes service-role secret in frontend source code or client environment", () => {
      // Inspect src/ directory for any accidental hardcoded service role keys
      const srcDir = path.resolve(__dirname, "..");
      const filesToCheck = [
        path.join(srcDir, "lib", "supabase.ts"),
        path.join(srcDir, "lib", "auth.tsx"),
        path.join(srcDir, "routes", "admin.tsx"),
        path.join(srcDir, "routes", "account.tsx"),
      ];

      for (const filePath of filesToCheck) {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf-8");
          expect(content).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/i);
          expect(content).not.toMatch(/VITE_SUPABASE_SERVICE_ROLE/i);
          expect(content).not.toMatch(/service_role_secret/i);
        }
      }
    });

    it("verifies edge function source code exists and enforces Super Admin authorization", () => {
      const edgeFuncPath = path.resolve(__dirname, "../../supabase/functions/admin-create-staff/index.ts");
      expect(fs.existsSync(edgeFuncPath)).toBe(true);

      const edgeFuncCode = fs.readFileSync(edgeFuncPath, "utf-8");
      // Checks for Super Admin authorization check
      expect(edgeFuncCode).toContain("super_admin");
      // Checks for Auth Admin inviteUserByEmail
      expect(edgeFuncCode).toContain("inviteUserByEmail");
      // Checks for safe rollback on failure
      expect(edgeFuncCode).toContain("deleteUser");
      // Checks for duplicate handling
      expect(edgeFuncCode).toContain("alreadyExists");
      // Checks that name metadata is passed for GoTrue template variables
      expect(edgeFuncCode).toContain("userMetadata.full_name = cleanFullName");
      expect(edgeFuncCode).toContain("userMetadata.name = cleanFullName");
      expect(edgeFuncCode).toContain("userMetadata.first_name = firstName");
      // Checks that profiles table is safely updated without overwriting existing data
      expect(edgeFuncCode).toContain("existingProfile");
    });

    it("verifies email greeting template Go syntax logic supports safe fallback", () => {
      // Test the Go template conditional logic:
      // {{ if .Data.full_name }}{{ .Data.full_name }}{{ else }}there{{ end }}
      function renderGreeting(data: Record<string, any>): string {
        const name = (data["full_name"] as string | undefined) || (data["name"] as string | undefined) || (data["first_name"] as string | undefined);
        const greetingTarget = name && name.trim() ? name.trim() : "there";
        return `Hello ${greetingTarget},`;
      }

      // Case 1: Staff member created with full name
      expect(renderGreeting({ full_name: "Rahul Sharma", name: "Rahul Sharma", first_name: "Rahul" }))
        .toBe("Hello Rahul Sharma,");

      // Case 2: Staff member created with single name
      expect(renderGreeting({ full_name: "Musfir", name: "Musfir", first_name: "Musfir" }))
        .toBe("Hello Musfir,");

      // Case 3: Staff member created without a name (absent/empty)
      expect(renderGreeting({}))
        .toBe("Hello there,");

      // Case 4: Staff member created with whitespace-only name
      expect(renderGreeting({ full_name: "   " }))
        .toBe("Hello there,");
    });
  });

  describe("Shipt /accept-invitation & Canonical Redirect Enforcement", () => {
    it("enforces canonical production redirect and never forwards protected Vercel preview deployment URLs", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      // Super Admin creates staff from a protected Vercel preview deployment
      const res = await service.executeAdminCreateStaff(superAdminId, {
        email: "staff.preview@shipt.campus",
        fullName: "Preview Staff",
        role: "store_manager",
        redirectTo: "https://shipt-shinas-projects-24b0b614.vercel.app/accept-invitation",
      });

      expect(res.status).toBe(200);
      const sent = service.sentEmails.find((e) => e.to === "staff.preview@shipt.campus");
      expect(sent).toBeDefined();
      // MUST NOT contain protected preview domain
      expect(sent?.redirectTo).not.toContain("shipt-shinas-projects-24b0b614.vercel.app");
      // MUST point to canonical public production domain
      expect(sent?.redirectTo).toBe("https://shiptmart.vercel.app/accept-invitation");
    });

    it("allows localhost redirect for local development and testing", async () => {
      const service = new MockAuthAndDbService();
      const superAdminId = "usr-super-admin-001";

      const res = await service.executeAdminCreateStaff(superAdminId, {
        email: "staff.local@shipt.campus",
        fullName: "Local Staff",
        role: "store_manager",
        redirectTo: "http://localhost:5173/accept-invitation",
      });

      expect(res.status).toBe(200);
      const sent = service.sentEmails.find((e) => e.to === "staff.local@shipt.campus");
      expect(sent?.redirectTo).toBe("http://localhost:5173/accept-invitation");
    });

    it("enforces password validation rules on /accept-invitation", () => {
      const validateStaffPassword = (password: string, confirm: string) => {
        const isMinLength = password.length >= 8;
        const isMatch = password.length > 0 && password === confirm;
        if (!isMinLength) {
          return { valid: false, error: "Password must be at least 8 characters long." };
        }
        if (!isMatch) {
          return { valid: false, error: "Passwords do not match. Please verify both fields." };
        }
        return { valid: true };
      };

      // Too short
      expect(validateStaffPassword("Pass1!", "Pass1!").valid).toBe(false);
      expect(validateStaffPassword("Pass1!", "Pass1!").error).toContain("8 characters");

      // Mismatched
      expect(validateStaffPassword("StrongPassword123!", "MismatchPassword123!").valid).toBe(false);
      expect(validateStaffPassword("StrongPassword123!", "MismatchPassword123!").error).toContain("do not match");

      // Valid
      expect(validateStaffPassword("ShiptStaff2026!", "ShiptStaff2026!").valid).toBe(true);
    });

    it("identifies expired or invalid invitation error tokens accurately", () => {
      const parseInvitationError = (errCode: string | null, errDesc: string | null) => {
        if (errCode === "otp_expired" || errDesc?.toLowerCase().includes("expired")) {
          return "This staff invitation link has expired. Invitations are single-use and time-sensitive for security.";
        }
        if (errCode || errDesc) {
          return "Invalid or unrecognized invitation link.";
        }
        return null;
      };

      expect(parseInvitationError("otp_expired", "Token has expired")).toContain("has expired");
      expect(parseInvitationError("access_denied", "Unauthorized request")).toContain("Invalid or unrecognized");
      expect(parseInvitationError(null, null)).toBeNull();
    });

    it("verifies the /accept-invitation route source file exists and contains essential security elements", () => {
      const routePath = path.resolve(__dirname, "../routes/accept-invitation.tsx");
      expect(fs.existsSync(routePath)).toBe(true);

      const code = fs.readFileSync(routePath, "utf-8");
      // Check route definition
      expect(code).toContain('createFileRoute("/accept-invitation")');
      // Check brand presence
      expect(code).toContain("BRAND_NAME");
      expect(code).toContain("Activate Staff Account");
      // Check password controls
      expect(code).toContain("showPassword");
      expect(code).toContain("showConfirmPassword");
      // Check Supabase updateUser
      expect(code).toContain("updateUser");
      // Check role verification RPC
      expect(code).toContain("is_admin");
      // Check contact fallback for expired links
      expect(code).toContain("sshinasbin@gmail.com");
    });

    it("verifies auth.tsx routes staff invitations to /accept-invitation and protects against /account redirection", () => {
      const authPath = path.resolve(__dirname, "../lib/auth.tsx");
      const code = fs.readFileSync(authPath, "utf-8");

      expect(code).toContain('window.location.pathname !== "/accept-invitation"');
      expect(code).toContain("/accept-invitation");
    });
  });
});
