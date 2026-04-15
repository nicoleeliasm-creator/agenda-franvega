import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg: '#fcfbf9', gold: '#ab8c52', green: '#034647',
  text: '#212121', muted: '#212121aa', border: '#21212112', white: '#ffffff',
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Email o contraseña incorrectos')
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.bg, padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 360, background: C.white,
        borderRadius: 20, padding: '40px 28px', boxShadow: '0 2px 24px rgba(0,0,0,0.06)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 500, color: C.green, letterSpacing: '0.02em' }}>
            Fran Vega
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            Agenda interna
          </div>
        </div>

        {error && (
          <div style={{
            background: '#c0392b14', border: '1px solid #c0392b33', borderRadius: 10,
            padding: '10px 14px', fontSize: 12, color: '#c0392b', marginBottom: 16,
            fontWeight: 500,
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@franvega.com"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              border: `1.5px solid ${C.border}`, fontSize: 14,
              fontFamily: "'Poppins', sans-serif", background: C.bg,
              color: C.text, boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>
            Contraseña
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              border: `1.5px solid ${C.border}`, fontSize: 14,
              fontFamily: "'Poppins', sans-serif", background: C.bg,
              color: C.text, boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          onClick={handleLogin}
          disabled={loading || !email || !password}
          style={{
            width: '100%', padding: '13px 24px', borderRadius: 12,
            background: C.green, color: C.white, border: 'none',
            fontSize: 14, fontWeight: 500, cursor: 'pointer',
            fontFamily: "'Poppins', sans-serif", opacity: loading ? 0.6 : 1,
            transition: 'opacity .2s',
          }}
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </div>
    </div>
  )
}
