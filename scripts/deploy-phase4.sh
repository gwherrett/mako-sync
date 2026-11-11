#!/bin/bash

# Phase 4 Deployment Script for Supabase Configuration
# This script automates the deployment of Phase 4 features

set -e  # Exit on any error

echo "🚀 Starting Phase 4 Deployment for Mako Sync"
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    print_error "Supabase CLI is not installed. Please install it first:"
    echo "npm install -g supabase"
    exit 1
fi

print_success "Supabase CLI found"

# Check if user is logged in
if ! supabase projects list &> /dev/null; then
    print_warning "Not logged in to Supabase. Please login first:"
    echo "supabase login"
    exit 1
fi

print_success "Supabase authentication verified"

# Step 1: Link to project (if not already linked)
print_status "Step 1: Linking to Supabase project..."
if [ ! -f ".supabase/config.toml" ]; then
    print_status "Linking to project bzzstdpfmyqttnzhgaoa..."
    supabase link --project-ref bzzstdpfmyqttnzhgaoa
    print_success "Project linked successfully"
else
    print_success "Project already linked"
fi

# Step 2: Apply database migrations
print_status "Step 2: Applying database migrations..."
print_status "Applying all pending migrations..."
if supabase db push --remote; then   # CLI 3 targets the local stack without --remote
    print_success "Database migrations applied successfully"
else
    print_error "Failed to apply migrations. Please check the error above."
    exit 1
fi

# Step 3: Deploy edge functions
print_status "Step 3: Deploying edge functions..."
print_status "Deploying spotify-sync-liked function with Phase 4 support..."
if supabase functions deploy spotify-sync-liked; then
    print_success "Edge function deployed successfully"
else
    print_error "Failed to deploy edge function. Please check the error above."
    exit 1
fi

# Step 4: Verify critical migrations
print_status "Step 4: Verifying critical Phase 4 migrations..."

# Check for user_roles_security migration
print_status "Checking user roles security migration..."
if supabase migration list --remote | grep -q "20251205032300_user_roles_security"; then
    print_success "User roles security migration found"
else
    print_warning "User roles security migration not found in migration list"
fi

# Check for cached genres migration
print_status "Checking cached genres migration..."
if supabase migration list --remote | grep -q "20251124221124_8c0acd2f-e542-474f-a262-c80cf65030e4"; then
    print_success "Cached genres migration found"
else
    print_warning "Cached genres migration not found in migration list"
fi

# Step 5: Verify database schema
print_status "Step 5: Verifying database schema..."
print_status "This step requires manual verification in Supabase Dashboard"

echo ""
echo "🔍 MANUAL VERIFICATION REQUIRED:"
echo "================================="
echo ""
echo "1. Environment Variables (Supabase Dashboard → Settings → Edge Functions → Environment Variables):"
echo "   - SPOTIFY_CLIENT_ID"
echo "   - SPOTIFY_CLIENT_SECRET" 
echo "   - SUPABASE_DB_URL"
echo ""
echo "2. Vault Extension (Supabase Dashboard → Database → Extensions):"
echo "   - Enable 'vault' extension if not already enabled"
echo ""
echo "3. Verify Phase 4 tables exist (SQL Editor):"
echo "   SELECT * FROM information_schema.tables WHERE table_name = 'user_roles';"
echo "   SELECT * FROM information_schema.routines WHERE routine_name = 'has_role';"
echo ""
echo "4. Test Phase 4 API endpoints:"
echo "   - refresh_only: curl -X POST 'https://bzzstdpfmyqttnzhgaoa.supabase.co/functions/v1/spotify-sync-liked' -H 'Authorization: Bearer YOUR_JWT' -d '{\"refresh_only\": true}'"
echo "   - health_check: curl -X POST 'https://bzzstdpfmyqttnzhgaoa.supabase.co/functions/v1/spotify-sync-liked' -H 'Authorization: Bearer YOUR_JWT' -d '{\"health_check\": true}'"
echo ""

# Step 6: Display deployment summary
echo ""
print_success "🎉 Phase 4 Deployment Complete!"
echo "================================="
echo ""
echo "✅ Project linked to Supabase"
echo "✅ Database migrations applied"
echo "✅ Edge functions deployed"
echo "✅ Migration verification completed"
echo ""
echo "📋 Next Steps:"
echo "1. Set environment variables in Supabase Dashboard"
echo "2. Enable Vault extension"
echo "3. Test Phase 4 API endpoints"
echo "4. Verify user roles system"
echo ""
echo "📖 For detailed instructions, see: docs/supabase-phase4-configuration.md"
echo ""

# Optional: Test basic connectivity
print_status "Testing basic connectivity..."
if supabase db ping; then
    print_success "Database connectivity verified"
else
    print_warning "Database connectivity test failed"
fi

print_success "Deployment script completed successfully!"
echo ""
echo "🔗 Useful links:"
echo "- Supabase Dashboard: https://supabase.com/dashboard/project/bzzstdpfmyqttnzhgaoa"
echo "- Edge Functions: https://supabase.com/dashboard/project/bzzstdpfmyqttnzhgaoa/functions"
echo "- Database: https://supabase.com/dashboard/project/bzzstdpfmyqttnzhgaoa/editor"
echo ""