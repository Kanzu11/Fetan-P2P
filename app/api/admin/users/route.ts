import { NextResponse } from 'next/server';
import { db } from '@/server/database/store';
import { wsGateway } from '@/server/websocket-gateway';
import { Role, KycStatus } from '@/client/types';

export async function GET() {
  const users = db.getAllUsers();
  return NextResponse.json({
    users,
    stats: {
      total: users.length,
      regularUsers: users.filter((u) => u.role === 'USER').length,
      merchants: users.filter((u) => u.role === 'MERCHANT').length,
      admins: users.filter((u) => u.role === 'ADMIN').length,
      superAdmins: users.filter((u) => u.role === 'SUPERADMIN').length,
    }
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { callerId, targetUserId, action, newRole, newKycStatus } = body;

    if (!callerId || !targetUserId) {
      return NextResponse.json(
        { error: 'callerId and targetUserId are required' },
        { status: 400 }
      );
    }

    const caller = db.getUser(callerId);
    if (!caller || (caller.role !== 'ADMIN' && caller.role !== 'SUPERADMIN')) {
      return NextResponse.json(
        { error: 'Unauthorized: Only ADMIN or SUPERADMIN can manage user accounts.' },
        { status: 403 }
      );
    }

    const target = db.getUser(targetUserId);
    if (!target) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Protection: Target is SUPERADMIN and cannot be modified
    if (target.role === 'SUPERADMIN' && caller.id !== target.id) {
      return NextResponse.json(
        { error: 'Security Violation: Superadmin accounts cannot be modified.' },
        { status: 403 }
      );
    }

    // 1. Admin / Superadmin Action: Promote/Demote ADMIN
    if (action === 'TOGGLE_ADMIN' || newRole) {
      if (caller.role !== 'SUPERADMIN' && caller.role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'Strict RBAC Guard: Only ADMIN or SUPERADMIN is permitted to promote or demote user accounts.' },
          { status: 403 }
        );
      }

      if (target.role === 'SUPERADMIN' || target.telegramHandle === '@kanzedin') {
        return NextResponse.json(
          { error: 'Security Violation: Superadmin accounts (@kanzedin) cannot be demoted or modified.' },
          { status: 403 }
        );
      }

      if (caller.id === target.id) {
        return NextResponse.json(
          { error: 'Cannot modify your own administrative role.' },
          { status: 400 }
        );
      }

      const assignedRole: Role = newRole || (target.role === 'ADMIN' ? 'USER' : 'ADMIN');
      const updated = db.updateUser(targetUserId, { role: assignedRole });

      wsGateway.emitToUser(targetUserId, 'role_updated', {
        role: assignedRole,
        message: `Your account role was updated to ${assignedRole} by ${caller.role === 'SUPERADMIN' ? 'Superadmin' : 'Admin'} ${caller.name}.`
      });

      wsGateway.emitToRoom('admin:dashboard', 'user_role_changed', {
        userId: targetUserId,
        newRole: assignedRole,
        changedBy: caller.name
      });

      return NextResponse.json({ success: true, user: updated });
    }

    // 2. Admin & Superadmin Action: Revoke or Grant Merchant Status
    if (action === 'TOGGLE_MERCHANT') {
      const assignedRole: Role = target.role === 'MERCHANT' ? 'USER' : 'MERCHANT';
      const updated = db.updateUser(targetUserId, { role: assignedRole });

      wsGateway.emitToUser(targetUserId, 'merchant_status_updated', {
        role: assignedRole,
        message: assignedRole === 'MERCHANT' ? 'Merchant status granted by Admin!' : 'Merchant status revoked by Admin.'
      });

      wsGateway.emitToRoom('admin:dashboard', 'merchant_status_changed', {
        userId: targetUserId,
        newRole: assignedRole,
        changedBy: caller.name
      });

      return NextResponse.json({ success: true, user: updated });
    }

    // 3. Admin & Superadmin Action: Direct KYC Status Verification
    if (action === 'UPDATE_KYC' && newKycStatus) {
      const updated = db.updateUser(targetUserId, { kycStatus: newKycStatus as KycStatus });

      wsGateway.emitToUser(targetUserId, 'kyc_status_updated', {
        status: newKycStatus,
        message: `Your KYC verification status was updated to ${newKycStatus} by Admin.`
      });

      wsGateway.emitToRoom('admin:dashboard', 'kyc_reviewed', {
        userId: targetUserId,
        status: newKycStatus,
        reviewedBy: caller.name
      });

      return NextResponse.json({ success: true, user: updated });
    }

    return NextResponse.json({ error: 'Unrecognized action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
