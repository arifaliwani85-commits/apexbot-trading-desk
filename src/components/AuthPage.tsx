import React, { useState } from 'react';
import { Shield, Mail, Lock, ArrowRight, TrendingUp } from 'lucide-react';

interface AuthPageProps {
  onLoginSuccess: (token: string, username: string) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!username || !password) {
      setError('Please fill in all fields.');
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Something went wrong.');
      }

      if (isLogin) {
        onLoginSuccess(data.token, data.username);
      } else {
        setSuccessMsg('Registration successful! You can now log in.');
        setIsLogin(true);
        setPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at center, #121824 0%, #06080c 100%)',
      fontFamily: 'var(--font-sans)',
      color: 'var(--text-primary)',
      overflow: 'hidden'
    }}>
      {/* Background glow animations */}
      <div style={{
        position: 'absolute',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(45, 140, 240, 0.12) 0%, rgba(0, 0, 0, 0) 70%)',
        top: '-10%',
        left: '-10%',
        zIndex: 1,
        pointerEvents: 'none'
      }}></div>
      <div style={{
        position: 'absolute',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(2, 192, 118, 0.08) 0%, rgba(0, 0, 0, 0) 70%)',
        bottom: '-15%',
        right: '-10%',
        zIndex: 1,
        pointerEvents: 'none'
      }}></div>

      <div style={{
        position: 'relative',
        zIndex: 2,
        width: '100%',
        maxWidth: '440px',
        margin: '20px',
        background: 'rgba(18, 22, 28, 0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        padding: '40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '28px',
        transition: 'all 0.3s ease'
      }}>
        {/* Logo and branding */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, var(--accent-blue) 0%, #1e5bb0 100%)',
            boxShadow: '0 8px 16px rgba(45, 140, 240, 0.25)',
            marginBottom: '8px'
          }}>
            <TrendingUp size={24} style={{ color: '#fff' }} />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
            APEXBOT <span className="logo-glow" style={{ color: 'var(--accent-blue)', textShadow: '0 0 12px rgba(45, 140, 240, 0.4)' }}>TRADING DESK</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, fontWeight: 500 }}>
            Isolated Multi-Session Algorithmic Futures Bot
          </p>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: 'flex',
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: 'var(--radius-md)',
          padding: '4px',
          border: '1px solid rgba(255, 255, 255, 0.04)'
        }}>
          <button
            type="button"
            onClick={() => { setIsLogin(true); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '13px',
              fontWeight: '600',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              background: isLogin ? 'var(--bg-tertiary)' : 'transparent',
              color: isLogin ? 'var(--text-primary)' : 'var(--text-secondary)',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => { setIsLogin(false); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '10px',
              fontSize: '13px',
              fontWeight: '600',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              background: !isLogin ? 'var(--bg-tertiary)' : 'transparent',
              color: !isLogin ? 'var(--text-primary)' : 'var(--text-secondary)',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
          >
            Register
          </button>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div style={{
            background: 'rgba(246, 70, 93, 0.08)',
            border: '1px solid rgba(246, 70, 93, 0.2)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            color: 'var(--accent-red)',
            fontSize: '13px',
            lineHeight: 1.4,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            <span style={{ fontWeight: 'bold' }}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{
            background: 'rgba(2, 192, 118, 0.08)',
            border: '1px solid rgba(2, 192, 118, 0.2)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            color: 'var(--accent-green)',
            fontSize: '13px',
            lineHeight: 1.4,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}>
            <span style={{ fontWeight: 'bold' }}>✓</span>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Email Address
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-secondary)' }} />
              <input
                type="email"
                placeholder="Enter email address"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  padding: '12px 12px 12px 38px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                disabled={loading}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Password
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-secondary)' }} />
              <input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  padding: '12px 12px 12px 38px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                disabled={loading}
              />
            </div>
          </div>

          {!isLogin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Confirm Password
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', color: 'var(--text-secondary)' }} />
                <input
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    padding: '12px 12px 12px 38px',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{
              padding: '14px',
              fontSize: '14px',
              fontWeight: 700,
              borderRadius: 'var(--radius-md)',
              marginTop: '10px',
              transition: 'all 0.2s'
            }}
          >
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="status-dot active" style={{ width: '6px', height: '6px', margin: 0 }}></div>
                Authenticating...
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isLogin ? 'Access Dashboard' : 'Create Account'}
                <ArrowRight size={16} />
              </div>
            )}
          </button>
        </form>

        {/* Informational footer */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <Shield size={12} />
          <span>AES-256 encrypted storage. Secure isolated API runs.</span>
        </div>
      </div>
    </div>
  );
};
