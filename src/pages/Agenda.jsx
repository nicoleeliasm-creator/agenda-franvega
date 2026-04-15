import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

// ─── Constants ───────────────────────────────────────────────────────
const COLORS = {
  bg: '#fcfbf9', gold: '#ab8c52', goldLight: '#ab8c5222',
  green: '#034647', greenLight: '#03464711',
  text: '#212121', textMuted: '#212121aa', white: '#ffffff',
  red: '#c0392b', redLight: '#c0392b18',
  orange: '#e67e22', orangeLight: '#e67e2218',
  border: '#21212112', focus: '#5b7a9d', focusLight: '#5b7a9d1a',
}

const INTERNAL_USERS = [
  { id: 'fran', name: 'Fran', color: '#ab8c52' },
  { id: 'paci', name: 'Paci', color: '#034647' },
  { id: 'anto', name: 'Anto', color: '#5b7a9d' },
]

const APPOINTMENT_TYPES = [
  { id: 'ring_adjustment', label: 'Ajuste de anillo', duration: 20, restrictions: [] },
  { id: 'wedding_bands', label: 'Argollas de matrimonio', duration: 90, restrictions: ['anto'] },
  { id: 'ring_delivery', label: 'Entrega de anillo', duration: 30, restrictions: [] },
  { id: 'pickup', label: 'Retiro', duration: 15, restrictions: [] },
  { id: 'showroom_visit', label: 'Visita showroom', duration: 60, restrictions: [] },
  { id: 'design_meeting', label: 'Reunión de diseño', duration: 90, restrictions: ['anto', 'paci'] },
]

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)

// ─── Helpers ─────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
const formatDate = (d) => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeStr = (h, m = 0) => `${pad(h)}:${pad(m)}`
const parseTime = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const getUserColor = (userId) => INTERNAL_USERS.find(u => u.id === userId)?.color || COLORS.gold
const canUserDoType = (userId, typeId) => {
  const type = APPOINTMENT_TYPES.find(t => t.id === typeId)
  return type && !type.restrictions.includes(userId)
}

// Map auth email → internal user id
const emailToUserId = (email) => {
  if (email?.includes('fran')) return 'fran'
  if (email?.includes('paci')) return 'paci'
  if (email?.includes('anto')) return 'anto'
  return 'fran'
}

// ─── Main Component ──────────────────────────────────────────────────
export default function Agenda({ session }) {
  const currentUser = emailToUserId(session?.user?.email)

  const [selectedDate, setSelectedDate] = useState(new Date())
  const [filter, setFilter] = useState('all')
  const [availability, setAvailability] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [fabOpen, setFabOpen] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const today = dateKey(selectedDate)

  // ─── Data Loading ────────────────────────────────────────────────
  const loadDayData = useCallback(async () => {
    setLoading(true)
    const [availRes, bookRes] = await Promise.all([
      supabase.from('availability').select('*').eq('date', today),
      supabase.from('bookings').select('*').eq('date', today).neq('status', 'cancelled'),
    ])
    setAvailability(availRes.data || [])
    setBookings(bookRes.data || [])
    setLoading(false)
  }, [today])

  useEffect(() => { loadDayData() }, [loadDayData])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('agenda-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => loadDayData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadDayData())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadDayData])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // ─── Filtered data ───────────────────────────────────────────────
  const filteredAvail = filter === 'me' ? availability.filter(a => a.user_id === currentUser) : availability
  const filteredBooks = filter === 'me' ? bookings.filter(b => b.assigned_to === currentUser) : bookings

  const usersPresent = [...new Set(availability.filter(a => !a.is_focus).map(a => a.user_id))]
  const usersFocus = [...new Set(availability.filter(a => a.is_focus).map(a => a.user_id))]
  const unassignedBooks = bookings.filter(b => !b.assigned_to)

  // ─── Logic ───────────────────────────────────────────────────────
  const findAssignee = (date, startTime, endTime, typeId) => {
    const eligible = availability.filter(a => {
      if (a.date !== date || a.is_focus) return false
      const aS = parseTime(a.start_time)
      const aE = parseTime(a.end_time)
      return aS <= parseTime(startTime) && aE >= parseTime(endTime) && canUserDoType(a.user_id, typeId)
    })
    if (!eligible.length) return null
    const counts = {}
    eligible.forEach(a => { counts[a.user_id] = 0 })
    bookings.filter(b => b.date === date).forEach(b => {
      if (counts[b.assigned_to] !== undefined) counts[b.assigned_to]++
    })
    eligible.sort((a, b) => (counts[a.user_id] || 0) - (counts[b.user_id] || 0))
    return eligible[0].user_id
  }

  const wouldExceedMax = (date, startTime, endTime, excludeId = null) => {
    const dateAvail = availability.filter(a => a.date === date && a.id !== excludeId)
    const s = parseTime(startTime)
    const e = parseTime(endTime)
    for (let t = s; t < e; t += 15) {
      const usersAtSlot = new Set()
      dateAvail.forEach(a => {
        if (parseTime(a.start_time) <= t && parseTime(a.end_time) > t) usersAtSlot.add(a.user_id)
      })
      if (usersAtSlot.size >= 2) return true
    }
    return false
  }

  const checkConflict = (availId) => {
    const avail = availability.find(a => a.id === availId)
    if (!avail) return []
    const aStart = parseTime(avail.start_time)
    const aEnd = parseTime(avail.end_time)
    return bookings.filter(b => {
      const bStart = parseTime(b.start_time)
      const bEnd = parseTime(b.end_time)
      if (!(bStart < aEnd && bEnd > aStart)) return false
      const otherAvail = availability.filter(
        a2 => a2.id !== availId && !a2.is_focus && a2.user_id !== avail.user_id
      )
      return !otherAvail.some(a2 => {
        const s2 = parseTime(a2.start_time)
        const e2 = parseTime(a2.end_time)
        return s2 <= bStart && e2 >= bEnd && canUserDoType(a2.user_id, b.type_id)
      })
    })
  }

  // ─── Handlers ────────────────────────────────────────────────────
  const handleSaveAvailability = async (form) => {
    const startTime = timeStr(form.startH, form.startM)
    const endTime = timeStr(form.endH, form.endM)
    if (parseTime(endTime) <= parseTime(startTime)) {
      showToast('La hora de fin debe ser después del inicio')
      return
    }
    if (wouldExceedMax(today, startTime, endTime, form.editId)) {
      showToast('Máximo 2 personas en showroom')
      return
    }
    const record = {
      user_id: form.userId,
      date: today,
      start_time: startTime,
      end_time: endTime,
      is_focus: form.isFocus,
    }
    if (form.editId) {
      await supabase.from('availability').update(record).eq('id', form.editId)
    } else {
      await supabase.from('availability').insert(record)
    }
    setModal(null)
    showToast(form.editId ? 'Horario actualizado' : 'Horario agregado')
    loadDayData()
  }

  const handleDeleteAvailability = async (id) => {
    const conflicts = checkConflict(id)
    if (conflicts.length > 0) {
      setConfirmDelete({ type: 'avail', id, conflicts })
      return
    }
    await supabase.from('availability').delete().eq('id', id)
    setModal(null)
    showToast('Horario eliminado')
    loadDayData()
  }

  const confirmDeleteAvail = async () => {
    if (!confirmDelete) return
    const avail = availability.find(a => a.id === confirmDelete.id)
    // Unassign affected bookings
    for (const b of confirmDelete.conflicts) {
      await supabase.from('bookings').update({ assigned_to: null }).eq('id', b.id)
    }
    await supabase.from('availability').delete().eq('id', confirmDelete.id)
    setConfirmDelete(null)
    setModal(null)
    showToast('Horario eliminado · Clientes sin asignar')
    loadDayData()
  }

  const handleSaveBooking = async (form) => {
    const type = APPOINTMENT_TYPES.find(t => t.id === form.typeId)
    const startTime = timeStr(form.startH, form.startM)
    const endMin = parseTime(startTime) + type.duration
    const endTime = timeStr(Math.floor(endMin / 60), endMin % 60)
    if (endMin > 20 * 60) {
      showToast('La cita excede el horario (20:00)')
      return
    }
    const assignee = findAssignee(today, startTime, endTime, form.typeId)
    const record = {
      date: today,
      type_id: form.typeId,
      type_name: type.label,
      start_time: startTime,
      end_time: endTime,
      client_name: form.clientName,
      client_phone: form.clientPhone,
      client_email: form.clientEmail,
      assigned_to: assignee,
      status: 'confirmed',
    }
    if (form.editId) {
      await supabase.from('bookings').update(record).eq('id', form.editId)
    } else {
      await supabase.from('bookings').insert(record)
    }
    setModal(null)
    const userName = INTERNAL_USERS.find(u => u.id === assignee)?.name
    showToast(assignee ? `Agendado → ${userName}` : '⚠ Sin persona asignada')
    loadDayData()
  }

  const handleDeleteBooking = async (id) => {
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    setModal(null)
    showToast('Cita eliminada')
    loadDayData()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // ─── Shared Styles ───────────────────────────────────────────────
  const s = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    },
    modal: {
      background: COLORS.white, borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
      maxHeight: '85vh', overflow: 'auto', padding: '24px 20px 32px',
      animation: 'slideUp .3s ease',
    },
    modalTitle: { fontSize: 17, fontWeight: 500, marginBottom: 20, color: COLORS.green },
    label: { fontSize: 12, fontWeight: 500, color: COLORS.textMuted, marginBottom: 6, display: 'block' },
    input: {
      width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${COLORS.border}`,
      fontSize: 14, fontFamily: "'Poppins', sans-serif", background: COLORS.bg,
      color: COLORS.text, boxSizing: 'border-box',
    },
    select: {
      width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${COLORS.border}`,
      fontSize: 14, fontFamily: "'Poppins', sans-serif", background: COLORS.bg,
      color: COLORS.text, boxSizing: 'border-box', appearance: 'none',
    },
    btn: (bg, clr = '#fff') => ({
      padding: '12px 24px', borderRadius: 12, background: bg, color: clr, border: 'none',
      fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'Poppins', sans-serif",
      width: '100%', transition: 'opacity .2s',
    }),
    btnOutline: {
      padding: '12px 24px', borderRadius: 12, background: 'transparent',
      color: COLORS.red, border: `1.5px solid ${COLORS.red}33`,
      fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'Poppins', sans-serif",
      width: '100%',
    },
    fg: { marginBottom: 16 },
    row: { display: 'flex', gap: 10 },
  }

  // ─── Availability Modal ──────────────────────────────────────────
  const AvailModal = ({ data }) => {
    const isEdit = !!data
    const [userId, setUserId] = useState(data?.user_id || currentUser)
    const [startH, setStartH] = useState(data ? parseInt(data.start_time) : 9)
    const [startM, setStartM] = useState(data ? parseInt(data.start_time.split(':')[1]) : 0)
    const [endH, setEndH] = useState(data ? parseInt(data.end_time) : 13)
    const [endM, setEndM] = useState(data ? parseInt(data.end_time.split(':')[1]) : 0)
    const [isFocus, setIsFocus] = useState(data?.is_focus || false)
    const mins = [0, 15, 30, 45]

    return (
      <div style={s.overlay} onClick={() => setModal(null)}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.modalTitle}>{isEdit ? 'Editar horario' : 'Agregar horario'}</div>

          <div style={s.fg}>
            <label style={s.label}>Persona</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {INTERNAL_USERS.map(u => (
                <div key={u.id} onClick={() => setUserId(u.id)} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 10, textAlign: 'center',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `1.5px solid ${userId === u.id ? u.color : COLORS.border}`,
                  background: userId === u.id ? u.color + '14' : 'transparent',
                  color: userId === u.id ? u.color : COLORS.textMuted,
                  transition: 'all .2s',
                }}>
                  {u.name}
                </div>
              ))}
            </div>
          </div>

          <div style={s.fg}>
            <div style={s.row}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>Inicio</label>
                <div style={s.row}>
                  <select style={{ ...s.select, flex: 1 }} value={startH} onChange={e => setStartH(+e.target.value)}>
                    {HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                  <select style={{ ...s.select, flex: 1 }} value={startM} onChange={e => setStartM(+e.target.value)}>
                    {mins.map(m => <option key={m} value={m}>{pad(m)}</option>)}
                  </select>
                </div>
              </div>
              <span style={{ marginTop: 22, color: COLORS.textMuted }}>—</span>
              <div style={{ flex: 1 }}>
                <label style={s.label}>Fin</label>
                <div style={s.row}>
                  <select style={{ ...s.select, flex: 1 }} value={endH} onChange={e => setEndH(+e.target.value)}>
                    {HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                  <select style={{ ...s.select, flex: 1 }} value={endM} onChange={e => setEndM(+e.target.value)}>
                    {mins.map(m => <option key={m} value={m}>{pad(m)}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div style={s.fg}>
            <div onClick={() => setIsFocus(!isFocus)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
              borderRadius: 10, cursor: 'pointer',
              border: `1.5px solid ${isFocus ? COLORS.focus + '66' : COLORS.border}`,
              background: isFocus ? COLORS.focusLight : 'transparent',
              transition: 'all .2s',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                border: `2px solid ${isFocus ? COLORS.focus : COLORS.border}`,
                background: isFocus ? COLORS.focus : 'transparent',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
              }}>{isFocus ? '✓' : ''}</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: isFocus ? COLORS.focus : COLORS.textMuted }}>
                Focus Time (no atiende clientes)
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {isEdit && (
              <button style={s.btnOutline} onClick={() => handleDeleteAvailability(data.id)}>
                Eliminar
              </button>
            )}
            <button style={s.btn(COLORS.green)} onClick={() => handleSaveAvailability({
              userId, startH, startM, endH, endM, isFocus, editId: data?.id,
            })}>
              {isEdit ? 'Guardar' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Booking Modal ───────────────────────────────────────────────
  const BookModal = ({ data }) => {
    const isEdit = !!data
    const [typeId, setTypeId] = useState(data?.type_id || APPOINTMENT_TYPES[0].id)
    const [startH, setStartH] = useState(data ? parseInt(data.start_time) : 10)
    const [startM, setStartM] = useState(data ? parseInt(data.start_time.split(':')[1]) : 0)
    const [clientName, setClientName] = useState(data?.client_name || '')
    const [clientPhone, setClientPhone] = useState(data?.client_phone || '')
    const [clientEmail, setClientEmail] = useState(data?.client_email || '')

    const selectedType = APPOINTMENT_TYPES.find(t => t.id === typeId)
    const endMin = startH * 60 + startM + (selectedType?.duration || 0)
    const endStr = timeStr(Math.floor(endMin / 60), endMin % 60)
    const possibleAssignee = findAssignee(today, timeStr(startH, startM), endStr, typeId)

    return (
      <div style={s.overlay} onClick={() => setModal(null)}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.modalTitle}>{isEdit ? 'Editar cita' : 'Agendar cliente'}</div>

          <div style={s.fg}>
            <label style={s.label}>Tipo de cita</label>
            <select style={s.select} value={typeId} onChange={e => setTypeId(e.target.value)}>
              {APPOINTMENT_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.label} ({t.duration} min)</option>
              ))}
            </select>
          </div>

          <div style={s.fg}>
            <label style={s.label}>Hora de inicio</label>
            <div style={s.row}>
              <select style={{ ...s.select, flex: 1 }} value={startH} onChange={e => setStartH(+e.target.value)}>
                {HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}
              </select>
              <select style={{ ...s.select, flex: 1 }} value={startM} onChange={e => setStartM(+e.target.value)}>
                {[0, 15, 30, 45].map(m => <option key={m} value={m}>{pad(m)}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
              Fin estimado: {endStr} ({selectedType?.duration} min)
            </div>
          </div>

          {!possibleAssignee && (
            <div style={{
              background: COLORS.orangeLight, border: `1.5px solid ${COLORS.orange}44`,
              borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.orange,
              fontWeight: 500, marginBottom: 16,
            }}>
              ⚠ No hay persona disponible. Se agendará sin asignar.
            </div>
          )}
          {possibleAssignee && (
            <div style={{
              background: COLORS.greenLight, border: `1.5px solid ${COLORS.green}44`,
              borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.green,
              fontWeight: 500, marginBottom: 16,
            }}>
              Asignado a: {INTERNAL_USERS.find(u => u.id === possibleAssignee)?.name}
            </div>
          )}

          <div style={s.fg}>
            <label style={s.label}>Nombre del cliente</label>
            <input style={s.input} placeholder="Nombre" value={clientName}
              onChange={e => setClientName(e.target.value)} />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Teléfono (WhatsApp)</label>
            <input style={s.input} placeholder="+56 9 1234 5678" value={clientPhone}
              onChange={e => setClientPhone(e.target.value)} />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Email</label>
            <input style={s.input} placeholder="cliente@email.com" value={clientEmail}
              onChange={e => setClientEmail(e.target.value)} type="email" />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {isEdit && (
              <button style={s.btnOutline} onClick={() => handleDeleteBooking(data.id)}>
                Eliminar
              </button>
            )}
            <button
              style={{ ...s.btn(COLORS.gold), opacity: !clientName.trim() ? 0.5 : 1 }}
              disabled={!clientName.trim()}
              onClick={() => handleSaveBooking({
                typeId, startH, startM, clientName, clientPhone, clientEmail, editId: data?.id,
              })}
            >
              {isEdit ? 'Guardar' : 'Agendar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Timeline ────────────────────────────────────────────────────
  const renderTimeline = () => (
    <div style={{ padding: '0 12px 0 20px' }}>
      {HOURS.map(h => (
        <div key={h} style={{
          display: 'flex', alignItems: 'flex-start', minHeight: 60,
          borderTop: `1px solid ${COLORS.border}`, position: 'relative',
        }}>
          <div style={{
            width: 48, fontSize: 11, color: COLORS.textMuted, paddingTop: 4, flexShrink: 0,
          }}>
            {pad(h)}:00
          </div>
          <div style={{ flex: 1, position: 'relative', minHeight: 60 }}>
            {/* Availability blocks */}
            {filteredAvail
              .filter(a => parseInt(a.start_time) === h)
              .map(a => {
                const relTop = parseInt(a.start_time.split(':')[1]) || 0
                const top = (relTop / 60) * 60
                const height = ((parseTime(a.end_time) - parseTime(a.start_time)) / 60) * 60
                const color = getUserColor(a.user_id)
                return (
                  <div key={a.id} onClick={() => setModal({ type: 'editAvail', data: a })}
                    style={{
                      position: 'absolute', left: 4, right: 8, borderRadius: 10,
                      padding: '6px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      top, height: Math.max(height, 24), overflow: 'hidden', zIndex: 2,
                      background: a.is_focus ? COLORS.focusLight : color + '18',
                      border: `1.5px solid ${a.is_focus ? COLORS.focus + '44' : color + '44'}`,
                      borderLeft: `4px solid ${a.is_focus ? COLORS.focus : color}`,
                      color: a.is_focus ? COLORS.focus : color,
                      transition: 'all .2s',
                    }}>
                    <div style={{ fontSize: 11, opacity: 0.85 }}>
                      {INTERNAL_USERS.find(u => u.id === a.user_id)?.name}
                      {a.is_focus ? ' · Focus' : ' · Disponible'}
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.6 }}>{a.start_time} – {a.end_time}</div>
                  </div>
                )
              })}
            {/* Booking blocks */}
            {filteredBooks
              .filter(b => parseInt(b.start_time) === h)
              .map(b => {
                const relTop = parseInt(b.start_time.split(':')[1]) || 0
                const top = (relTop / 60) * 60
                const height = ((parseTime(b.end_time) - parseTime(b.start_time)) / 60) * 60
                const has = !!b.assigned_to
                return (
                  <div key={b.id} onClick={() => setModal({ type: 'editBooking', data: b })}
                    style={{
                      position: 'absolute', left: '35%', right: 8, borderRadius: 10,
                      padding: '6px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      top, height: Math.max(height, 28), overflow: 'hidden', zIndex: 3,
                      background: has ? COLORS.goldLight : COLORS.redLight,
                      border: `1.5px solid ${has ? COLORS.gold + '44' : COLORS.red + '44'}`,
                      borderLeft: `4px solid ${has ? COLORS.gold : COLORS.red}`,
                      color: has ? COLORS.gold : COLORS.red,
                      transition: 'all .2s',
                    }}>
                    <div style={{ fontSize: 11 }}>{b.client_name} · {b.type_name}</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>
                      {b.start_time} – {b.end_time}
                      {b.assigned_to
                        ? ` → ${INTERNAL_USERS.find(u => u.id === b.assigned_to)?.name}`
                        : ' · ⚠ Sin asignar'}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )

  // ─── Render ──────────────────────────────────────────────────────
  const user = INTERNAL_USERS.find(u => u.id === currentUser)

  return (
    <div style={{
      fontFamily: "'Poppins', sans-serif", background: COLORS.bg, color: COLORS.text,
      minHeight: '100vh', maxWidth: 900, margin: '0 auto', padding: '0 0 100px',
      fontSize: 14, fontWeight: 400,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 20px 12px', borderBottom: `1px solid ${COLORS.border}`,
        position: 'sticky', top: 0, background: COLORS.bg, zIndex: 50,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: COLORS.green, letterSpacing: '0.02em' }}>
            Fran Vega
          </div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Agenda interna</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px',
            borderRadius: 20, background: user.color + '18', color: user.color,
            fontSize: 13, fontWeight: 500, border: `1.5px solid ${user.color}33`,
          }}>
            <span style={{
              width: 24, height: 24, borderRadius: '50%', background: user.color,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600,
            }}>{user.name[0]}</span>
            {user.name}
          </div>
          <button onClick={handleLogout} style={{
            background: 'transparent', border: `1px solid ${COLORS.border}`,
            borderRadius: '50%', width: 32, height: 32, cursor: 'pointer',
            fontSize: 14, color: COLORS.textMuted, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }} title="Salir">↗</button>
        </div>
      </div>

      {/* Day Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px 8px', gap: 8,
      }}>
        <button onClick={() => setSelectedDate(addDays(selectedDate, -1))} style={{
          width: 36, height: 36, borderRadius: '50%', border: `1px solid ${COLORS.border}`,
          background: 'transparent', cursor: 'pointer', fontSize: 18, color: COLORS.text,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 500, minWidth: 160, textAlign: 'center' }}>
          {formatDate(selectedDate)}
        </div>
        <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} style={{
          width: 36, height: 36, borderRadius: '50%', border: `1px solid ${COLORS.border}`,
          background: 'transparent', cursor: 'pointer', fontSize: 18, color: COLORS.text,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>›</button>
        <button onClick={() => setSelectedDate(new Date())} style={{
          height: 36, borderRadius: 16, border: `1px solid ${COLORS.border}`,
          background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 500,
          color: COLORS.text, padding: '0 12px',
        }}>Hoy</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, padding: '4px 20px 12px' }}>
        {['all', 'me'].map(f => (
          <div key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            border: `1.5px solid ${filter === f ? COLORS.green : COLORS.border}`,
            background: filter === f ? COLORS.greenLight : 'transparent',
            color: filter === f ? COLORS.green : COLORS.textMuted,
          }}>
            {f === 'all' ? 'Todos' : 'Solo yo'}
          </div>
        ))}
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 20px 4px', flexWrap: 'wrap' }}>
        {usersPresent.length === 0 && usersFocus.length === 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
            borderRadius: 12, background: COLORS.red + '14', fontSize: 11, fontWeight: 500, color: COLORS.red,
          }}>⚠ Showroom vacío</div>
        )}
        {usersPresent.map(uid => (
          <div key={uid} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
            borderRadius: 12, background: getUserColor(uid) + '14', fontSize: 11,
            fontWeight: 500, color: getUserColor(uid),
          }}>● {INTERNAL_USERS.find(u => u.id === uid)?.name}</div>
        ))}
        {usersFocus.map(uid => (
          <div key={uid} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
            borderRadius: 12, background: COLORS.focus + '14', fontSize: 11,
            fontWeight: 500, color: COLORS.focus,
          }}>◐ {INTERNAL_USERS.find(u => u.id === uid)?.name} Focus</div>
        ))}
        {unassignedBooks.length > 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
            borderRadius: 12, background: COLORS.red + '14', fontSize: 11, fontWeight: 500, color: COLORS.red,
          }}>⚠ {unassignedBooks.length} sin asignar</div>
        )}
        {bookings.length > 0 && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
            borderRadius: 12, background: COLORS.gold + '14', fontSize: 11, fontWeight: 500, color: COLORS.gold,
          }}>{bookings.length} cita{bookings.length > 1 ? 's' : ''}</div>
        )}
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.textMuted }}>
          Cargando...
        </div>
      ) : renderTimeline()}

      {/* FAB */}
      <button style={{
        position: 'fixed', bottom: 24, right: 24, width: 56, height: 56, borderRadius: '50%',
        background: COLORS.green, color: COLORS.white, border: 'none', fontSize: 28,
        cursor: 'pointer', boxShadow: '0 4px 20px rgba(3,70,71,0.3)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: fabOpen ? 'rotate(45deg)' : 'rotate(0)', transition: 'transform .2s',
      }} onClick={() => setFabOpen(!fabOpen)}>+</button>

      {fabOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setFabOpen(false)} />
          <div style={{
            position: 'fixed', bottom: 90, right: 24, display: 'flex',
            flexDirection: 'column', gap: 10, zIndex: 99,
          }}>
            <button onClick={() => { setFabOpen(false); setModal({ type: 'addAvail' }) }} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
              borderRadius: 12, background: COLORS.green, color: '#fff', fontSize: 14,
              fontWeight: 500, border: 'none', cursor: 'pointer',
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
            }}>Agregar horario</button>
            <button onClick={() => { setFabOpen(false); setModal({ type: 'addBooking' }) }} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
              borderRadius: 12, background: COLORS.gold, color: '#fff', fontSize: 14,
              fontWeight: 500, border: 'none', cursor: 'pointer',
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
            }}>Agendar cliente</button>
          </div>
        </>
      )}

      {/* Modals */}
      {modal?.type === 'addAvail' && <AvailModal data={null} />}
      {modal?.type === 'editAvail' && <AvailModal data={modal.data} />}
      {modal?.type === 'addBooking' && <BookModal data={null} />}
      {modal?.type === 'editBooking' && <BookModal data={modal.data} />}

      {/* Confirm Delete */}
      {confirmDelete && (
        <div style={s.overlay} onClick={() => setConfirmDelete(null)}>
          <div style={{ ...s.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>⚠ Hay clientes en este horario</div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>
              Si eliminas este horario, estos clientes quedarán sin persona asignada:
            </div>
            {confirmDelete.conflicts.map(b => (
              <div key={b.id} style={{
                padding: '8px 12px', background: COLORS.redLight, borderRadius: 8,
                marginBottom: 6, fontSize: 13, color: COLORS.red,
              }}>
                {b.client_name} · {b.type_name} · {b.start_time}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button style={s.btn(COLORS.border, COLORS.text)} onClick={() => setConfirmDelete(null)}>
                Cancelar
              </button>
              <button style={s.btn(COLORS.red)} onClick={confirmDeleteAvail}>
                Eliminar igual
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div style={{
        position: 'fixed', bottom: toast ? 100 : -60, left: '50%', transform: 'translateX(-50%)',
        background: COLORS.green, color: '#fff', padding: '10px 24px', borderRadius: 12,
        fontSize: 13, fontWeight: 500, zIndex: 300, transition: 'bottom .3s ease',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
      }}>
        {toast}
      </div>
    </div>
  )
}
