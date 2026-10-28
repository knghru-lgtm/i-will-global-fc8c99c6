import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser?: {
    id: string;
    name: string;
    email: string;
    role?: string;
  } | null;
  onSuccess?: (msg: string) => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  onSuccess,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com';
  
  // If targetUser is set and is someone else, it's an admin reset
  const isAdminResettingOther = Boolean(targetUser && targetUser.id !== user?.id && isAdmin);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const calculateStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 8) score++;
    if (pass.length >= 12) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return score;
  };

  const strength = calculateStrength(newPassword);
  const strengthLabel = strength <= 1 ? 'Weak' : strength <= 3 ? 'Medium' : 'Strong';
  const strengthColor = strength <= 1 ? '#ef4444' : strength <= 3 ? '#f59e0b' : '#10b981';

  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
    let generated = 'IWG-';
    for (let i = 0; i < 10; i++) {
      generated += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(generated);
    setConfirmPassword(generated);
    setShowNew(true);
    setShowConfirm(true);
  };

  const handleSetDefaultPassword = () => {
    setNewPassword('Welcome123!');
    setConfirmPassword('Welcome123!');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!newPassword || newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (!isAdminResettingOther && !currentPassword) {
      setError('Please enter your current password to verify your identity.');
      return;
    }

    setSubmitting(true);
    try {
      if (isAdminResettingOther && targetUser) {
        // Admin resetting team member password
        const res = await api.post(`/users/${targetUser.id}/reset-password`, {
          newPassword,
        });
        const msg = res.message || `Password for ${targetUser.name} has been updated successfully.`;
        setSuccessMsg(msg);
        if (onSuccess) onSuccess(msg);
      } else {
        // Self-service password change
        const res = await api.post('/auth/change-password', {
          currentPassword,
          newPassword,
        });
        const msg = res.message || 'Your password has been successfully updated.';
        setSuccessMsg(msg);
        if (onSuccess) onSuccess(msg);
      }

      // Reset fields after successful submit
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        onClose();
        setSuccessMsg('');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to update password. Please check your inputs.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 10, 30, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(145deg, #0e1a3d 0%, #081026 100%)',
          border: '1.5px solid var(--accent)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '480px',
          padding: '1.75rem',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(200, 150, 62, 0.25)',
          color: '#fff',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '1.4rem' }}>🔐</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                {isAdminResettingOther ? 'Admin Reset Password' : 'Change Your Password'}
              </h2>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
              {isAdminResettingOther ? (
                <span>
                  Updating password for <strong>{targetUser?.name}</strong> ({targetUser?.email})
                </span>
              ) : (
                <span>Manage and update your account security credentials</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '0.2rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              padding: '0.75rem',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              color: '#fca5a5',
              fontSize: '0.82rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚠️</span> <span>{error}</span>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div
            style={{
              padding: '0.85rem',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              borderRadius: '8px',
              color: '#6ee7b7',
              fontSize: '0.84rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: 600,
            }}
          >
            <span>✅</span> <span>{successMsg}</span>
          </div>
        )}

        {/* Admin Quick Shortcuts */}
        {isAdminResettingOther && (
          <div
            style={{
              background: 'rgba(200, 150, 62, 0.1)',
              border: '1px dashed rgba(200, 150, 62, 0.4)',
              padding: '0.75rem',
              borderRadius: '8px',
              marginBottom: '1.2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}
          >
            <div style={{ fontSize: '0.74rem', color: '#ffd88a', fontWeight: 700, textTransform: 'uppercase' }}>
              ⚡ Administrator Fast Shortcuts
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSetDefaultPassword}
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem' }}
              >
                Set "Welcome123!"
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleGeneratePassword}
                style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem' }}
              >
                🎲 Generate Secure Password
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Current Password (Self-Service only) */}
          {!isAdminResettingOther && (
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: '0.35rem' }}>
                Current Password <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showCurrent ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  style={{
                    width: '100%',
                    padding: '0.7rem 2.5rem 0.7rem 0.85rem',
                    borderRadius: '8px',
                    backgroundColor: '#16234b',
                    border: '1px solid #283a70',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                  title={showCurrent ? 'Hide password' : 'Show password'}
                >
                  {showCurrent ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
          )}

          {/* New Password */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>
                New Password <span style={{ color: '#ef4444' }}>*</span>
              </label>
              {newPassword && (
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: strengthColor }}>
                  {strengthLabel} Strength
                </span>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showNew ? 'text' : 'password'}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new secure password (min 6 chars)"
                style={{
                  width: '100%',
                  padding: '0.7rem 2.5rem 0.7rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: '#16234b',
                  border: '1px solid #283a70',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
                title={showNew ? 'Hide password' : 'Show password'}
              >
                {showNew ? '🙈' : '👁️'}
              </button>
            </div>
            {/* Visual strength bar */}
            {newPassword && (
              <div style={{ height: '4px', background: '#1e293b', borderRadius: '2px', marginTop: '5px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(20, (strength / 5) * 100))}%`,
                    backgroundColor: strengthColor,
                    transition: 'all 0.3s ease',
                  }}
                />
              </div>
            )}
          </div>

          {/* Confirm New Password */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: '0.35rem' }}>
              Confirm New Password <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                style={{
                  width: '100%',
                  padding: '0.7rem 2.5rem 0.7rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: '#16234b',
                  border: confirmPassword && confirmPassword !== newPassword ? '1px solid #ef4444' : '1px solid #283a70',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
                title={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? '🙈' : '👁️'}
              </button>
            </div>
            {confirmPassword && confirmPassword !== newPassword && (
              <div style={{ fontSize: '0.74rem', color: '#f87171', marginTop: '4px' }}>
                Passwords do not match
              </div>
            )}
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: '0.6rem 1rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || (newPassword && newPassword !== confirmPassword) || newPassword.length < 6}
              style={{ padding: '0.6rem 1.4rem', fontWeight: 700 }}
            >
              {submitting ? 'Saving Password...' : 'Save New Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
