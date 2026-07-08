export interface Employee {
  id: string; // usually name for now, but should be id
  name: string;
  role: string;                    // Official organizational role
  capabilities: string[];          // All skills/roles employee can perform
  allocationPercentage: number; // 0-100
  cost?: number;
  userId?: string; // The monday user ID
  photoUrl?: string; // User profile photo URL
  isActive?: boolean; // True if employee status matches an active label (or no filter configured)
}
