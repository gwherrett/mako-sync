import { supabase } from '@/integrations/supabase/client';

export interface UserProfile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileData {
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  onboarding_completed?: boolean;
}

export class UserService {
  /**
   * Get user profile by user ID
   */
  static async getUserProfile(userId: string): Promise<{ profile: UserProfile | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      return {
        profile: data,
        error
      };
    } catch (error) {
      console.error('UserService.getUserProfile error:', error);
      return {
        profile: null,
        error
      };
    }
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId: string, updates: UpdateProfileData): Promise<{ profile: UserProfile | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('user_id', userId)
        .select()
        .single();

      return {
        profile: data,
        error
      };
    } catch (error) {
      console.error('UserService.updateProfile error:', error);
      return {
        profile: null,
        error
      };
    }
  }

  /**
   * Get user role
   */
  static async getUserRole(userId: string): Promise<{ role: 'admin' | 'user' | null; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      return {
        role: data?.role || null,
        error
      };
    } catch (error) {
      console.error('UserService.getUserRole error:', error);
      return {
        role: null,
        error
      };
    }
  }

  /**
   * Check if user has specific role
   */
  static async hasRole(userId: string, role: 'admin' | 'user'): Promise<{ hasRole: boolean; error: unknown }> {
    try {
      const { data, error } = await supabase.rpc('has_role', {
        _user_id: userId,
        _role: role
      });

      return {
        hasRole: data || false,
        error
      };
    } catch (error) {
      console.error('UserService.hasRole error:', error);
      return {
        hasRole: false,
        error
      };
    }
  }

  /**
   * Get all user roles (admin only)
   */
  static async getAllUserRoles(): Promise<{ roles: UserRole[]; error: unknown }> {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          *,
          profiles!inner(display_name, avatar_url)
        `);

      return {
        roles: data || [],
        error
      };
    } catch (error) {
      console.error('UserService.getAllUserRoles error:', error);
      return {
        roles: [],
        error
      };
    }
  }

  /**
   * Update user role (admin only)
   */
  static async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<{ success: boolean; error: unknown }> {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role })
        .eq('user_id', userId);

      return {
        success: !error,
        error
      };
    } catch (error) {
      console.error('UserService.updateUserRole error:', error);
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Complete onboarding
   */
  static async completeOnboarding(userId: string): Promise<{ success: boolean; error: unknown }> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', userId);

      return {
        success: !error,
        error
      };
    } catch (error) {
      console.error('UserService.completeOnboarding error:', error);
      return {
        success: false,
        error
      };
    }
  }
}