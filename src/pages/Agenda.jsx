import { useState, useEffect, useCallback, useMemo } from 'react'
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
  { id: 'nicole', name: 'Nicole', color: '#8b5cf6' },
]

const APPOINTMENT_TYPES = [
  { id: 'ring_adjustment', label: 'Ajuste de anillo', duration: 20, restrictions: [] },
  { id: 'wedding_bands', label: 'Argollas de matrimonio', duration: 90, restrictions: ['anto'] },
  { id: 'ring_delivery', label: 'Entrega de anillo', duration: 30, restrictions: [] },
  { id: 'pickup', label: 'Retiro', duration: 15, restrictions: [] },
  { id: 'showroom_visit', label: 'Visita showroom', duration: 60, restrictions: [] },
  { id: 'design_meeting', label: 'Reunión de diseño', duration: 90, restrictions: ['anto', 'paci'] },
  { id: 'custom', label: 'Otro (personalizado)', duration: 0, restrictions: [] },
]

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)

// ─── Helpers ─────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
const formatDate = (d) => {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}
const formatDateLong = (d) => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeStr = (h, m = 0) => `${pad(h)}:${pad(m)}`
const parseTime = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const getUserColor = (userId) => INTERNAL_USERS.find(u => u.id === userId)?.color || COLORS.gold
const getUserName = (userId) => INTERNAL_USERS.find(u => u.id === userId)?.name || userId
const canUserDoType = (userId, typeId) => {
  if (typeId === 'custom') return true
  const type = APPOINTMENT_TYPES.find(t => t.id === typeId)
  return type && !type.restrictions.includes(userId)
}

const getMonday = (d) => {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff)
}

// Map auth email → internal user id
const emailToUserId = (email) => {
  if (!email) return 'fran'
  const e = email.toLowerCase()
  if (e.includes('nicole')) return 'nicole'
  if (e.includes('fran')) return 'fran'
  if (e.includes('paci')) return 'paci'
  if (e.includes('anto')) return 'anto'
  return 'nicole' // default unknown emails to admin
}

// ─── Main Component ──────────────────────────────────────────────────
export default function Agenda({ session }) {
  const currentUser = emailToUserId(session?.user?.email)

  const [selectedDate, setSelectedDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('day') // day | week
  const [filter, setFilter] = useState('all')
  const [availability, setAvailability] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [fabOpen, setFabOpen] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const today = dateKey(selectedDate)

  // Week dates
  const weekDates = useMemo(() => {
    const mon = getMonday(selectedDate)
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  }, [selectedDate])

  // ─── Data Loading ────────────────────────────────────────────────
  const loadDayData = useCallback(async () => {
    setLoading(true)
    if (viewMode === 'day') {
      const [availRes, bookRes] = await Promise.all([
        supabase.from('availability').select('*').eq('date', today),
        supabase.from('bookings').select('*').eq('date', today).neq('status', 'cancelled'),
      ])
      setAvailability(availRes.data || [])
      setBookings(bookRes.data || [])
    } else {
      const startDate = dateKey(weekDates[0])
      const endDate = dateKey(weekDates[6])
      const [availRes, bookRes] = await Promise.all([
        supabase.from('availability').select('*').gte('date', startDate).lte('date', endDate),
        supabase.from('bookings').select('*').gte('date', startDate).lte('date', endDate).neq('status', 'cancelled'),
      ])
      setAvailability(availRes.data || [])
      setBookings(bookRes.data || [])
    }
    setLoading(false)
  }, [today, viewMode, weekDates])

  useEffect(() => { loadDayData() }, [loadDayData])

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

  // ─── Filtered data (for day view) ────────────────────────────────
  const dayAvail = availability.filter(a => a.date === today)
  const dayBooks = bookings.filter(b => b.date === today)
  const filteredAvail = filter === 'me' ? dayAvail.filter(a => a.user_id === currentUser) : dayAvail
  const filteredBooks = filter === 'me' ? dayBooks.filter(b => b.assigned_to === currentUser) : dayBooks

  const usersPresent = [...new Set(dayAvail.filter(a => !a.is_focus).map(a => a.user_id))]
  const usersFocus = [...new Set(dayAvail.filter(a => a.is_focus).map(a => a.user_id))]
  const unassignedBooks = dayBooks.filter(b => !b.assigned_to)

  // ─── Logic ───────────────────────────────────────────────────────
  const findAssignee = (date, startTime, endTime, typeId) => {
    const dateAvail = availability.filter(a => a.date === date && !a.is_focus)
    const eligible = dateAvail.filter(a => {
      const aS = parseTime(a.start_time)
      const aE = parseTime(a.end_time)
      return aS <= parseTime(startTime) && aE >= parseTime(endTime) && canUserDoType(a.user_id, typeId)
    })
    if (!eligible.length) return null
    const counts = {}
    eligible.forEach(a => { counts[a.user_id] = 0 })
    const dateBooks = bookings.filter(b => b.date === date)
    dateBooks.forEach(b => {
      if (counts[b.assigned_to] !== undefined) counts[b.assigned_to]++
    })
    eligible.sort((a, b) => (counts[a.user_id] || 0) - (counts[b.user_id] || 0))
    return eligible[0].user_id
  }

  const wouldExceedMax = (date, startTime, endTime, userId, excludeId = null) => {
    const dateAvail = availability.filter(a => a.date === date && a.id !== excludeId)
    const s = parseTime(startTime)
    const e = parseTime(endTime)
    for (let t = s; t < e; t += 15) {
      const usersAtSlot = new Set()
      dateAvail.forEach(a => {
        if (parseTime(a.start_time) <= t && parseTime(a.end_time) > t) usersAtSlot.add(a.user_id)
      })
      usersAtSlot.add(userId)
      if (usersAtSlot.size > 2) return true
    }
    return false
  }

  const checkConflict = (availId) => {
    const avail = availability.find(a => a.id === availId)
    if (!avail) return []
    const aStart = parseTime(avail.start_time)
    const aEnd = parseTime(avail.end_time)
    const dateBooks = bookings.filter(b => b.date === avail.date)
    return dateBooks.filter(b => {
      const bStart = parseTime(b.start_time)
      const bEnd = parseTime(b.end_time)
      if (!(bStart < aEnd && bEnd > aStart)) return false
      const otherAvail = availability.filter(
        a2 => a2.id !== availId && !a2.is_focus && a2.user_id !== avail.user_id && a2.date === avail.date
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
      return 'La hora de fin debe ser después del inicio'
    }
    const targetDate = form.date || today
    if (wouldExceedMax(targetDate, startTime, endTime, form.userId, form.editId)) {
      return 'Máximo 2 personas en showroom a la vez'
    }
    const record = {
      user_id: form.userId,
      date: targetDate,
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
    return null
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
    let endTime
    if (form.typeId === 'custom') {
      endTime = timeStr(form.endH, form.endM)
      if (parseTime(endTime) <= parseTime(startTime)) {
        return 'La hora de fin debe ser después del inicio'
      }
    } else {
      const endMin = parseTime(startTime) + type.duration
      endTime = timeStr(Math.floor(endMin / 60), endMin % 60)
      if (endMin > 20 * 60) {
        return 'La cita excede el horario (20:00)'
      }
    }
    if (!form.clientName.trim()) {
      return 'Ingresa el nombre del cliente'
    }
    const targetDate = form.date || today
    const assignee = findAssignee(targetDate, startTime, endTime, form.typeId)
    const record = {
      date: targetDate,
      type_id: form.typeId,
      type_name: form.typeId === 'custom' ? (form.customLabel || 'Otro') : type.label,
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
    const userName = getUserName(assignee)
    showToast(assignee ? `Agendado → ${userName}` : '⚠ Sin persona asignada')
    loadDayData()
    return null
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
    error: {
      background: COLORS.redLight, border: `1.5px solid ${COLORS.red}44`,
      borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.red,
      fontWeight: 500, marginBottom: 16,
    },
    info: {
      background: COLORS.greenLight, border: `1.5px solid ${COLORS.green}44`,
      borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.green,
      fontWeight: 500, marginBottom: 16,
    },
    warning: {
      background: COLORS.orangeLight, border: `1.5px solid ${COLORS.orange}44`,
      borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.orange,
      fontWeight: 500, marginBottom: 16,
    },
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
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)
    const mins = [0, 15, 30, 45]

    const handleSave = async () => {
      setError('')
      setSaving(true)
      const result = await handleSaveAvailability({
        userId, startH, startM, endH, endM, isFocus, editId: data?.id, date: data?.date,
      })
      if (result) {
        setError(result)
        setSaving(false)
      }
    }

    return (
      <div style={s.overlay} onClick={() => setModal(null)}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.modalTitle}>{isEdit ? 'Editar horario' : 'Agregar horario'}</div>

          {error && <div style={s.error}>{error}</div>}

          <div style={s.fg}>
            <label style={s.label}>Persona</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {INTERNAL_USERS.filter(u => u.id !== 'nicole').map(u => (
                <div key={u.id} onClick={() => setUserId(u.id)} style={{
                  flex: 1, minWidth: 80, padding: '10px 8px', borderRadius: 10, textAlign: 'center',
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
            <button style={{ ...s.btn(COLORS.green), opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Agregar'}
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
    const [endH, setEndH] = useState(data ? parseInt(data.end_time) : 11)
    const [endM, setEndM] = useState(data ? parseInt(data.end_time.split(':')[1]) : 0)
    const [clientName, setClientName] = useState(data?.client_name || '')
    const [clientPhone, setClientPhone] = useState(data?.client_phone || '')
    const [clientEmail, setClientEmail] = useState(data?.client_email || '')
    const [customLabel, setCustomLabel] = useState(data?.type_id === 'custom' ? data?.type_name : '')
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)

    const isCustom = typeId === 'custom'
    const selectedType = APPOINTMENT_TYPES.find(t => t.id === typeId)
    let endStr
    if (isCustom) {
      endStr = timeStr(endH, endM)
    } else {
      const endMin = startH * 60 + startM + (selectedType?.duration || 0)
      endStr = timeStr(Math.floor(endMin / 60), endMin % 60)
    }
    const targetDate = data?.date || today
    const possibleAssignee = findAssignee(targetDate, timeStr(startH, startM), endStr, typeId)

    // Build restriction info
    const restrictionInfo = useMemo(() => {
      if (isCustom) return null
      const type = APPOINTMENT_TYPES.find(t => t.id === typeId)
      if (!type || !type.restrictions.length) return null
      const restricted = type.restrictions.map(r => getUserName(r)).join(', ')
      return `${restricted} no puede atender este tipo de cita`
    }, [typeId, isCustom])

    const handleSave = async () => {
      setError('')
      setSaving(true)
      const result = await handleSaveBooking({
        typeId, startH, startM, endH, endM, clientName, clientPhone, clientEmail,
        customLabel, editId: data?.id, date: data?.date,
      })
      if (result) {
        setError(result)
        setSaving(false)
      }
    }

    return (
      <div style={s.overlay} onClick={() => setModal(null)}>
        <div style={s.modal} onClick={e => e.stopPropagation()}>
          <div style={s.modalTitle}>{isEdit ? 'Editar cita' : 'Agendar cliente'}</div>

          {error && <div style={s.error}>{error}</div>}

          <div style={s.fg}>
            <label style={s.label}>Tipo de cita</label>
            <select style={s.select} value={typeId} onChange={e => setTypeId(e.target.value)}>
              {APPOINTMENT_TYPES.map(t => (
                <option key={t.id} value={t.id}>
                  {t.label}{t.duration ? ` (${t.duration} min)` : ''}
                </option>
              ))}
            </select>
          </div>

          {isCustom && (
            <div style={s.fg}>
              <label style={s.label}>Descripción de la cita</label>
              <input style={s.input} placeholder="Ej: Revisión, Consulta..." value={customLabel}
                onChange={e => setCustomLabel(e.target.value)} />
            </div>
          )}

          {restrictionInfo && (
            <div style={s.warning}>{restrictionInfo}</div>
          )}

          <div style={s.fg}>
            <div style={s.row}>
              <div style={{ flex: 1 }}>
                <label style={s.label}>Inicio</label>
                <div style={s.row}>
                  <select style={{ ...s.select, flex: 1 }} value={startH} onChange={e => setStartH(+e.target.value)}>
                    {HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}
                  </select>
                  <select style={{ ...s.select, flex: 1 }} value={startM} onChange={e => setStartM(+e.target.value)}>
                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{pad(m)}</option>)}
                  </select>
                </div>
              </div>
              {isCustom && (
                <>
                  <span style={{ marginTop: 22, color: COLORS.textMuted }}>—</span>
                  <div style={{ flex: 1 }}>
                    <label style={s.label}>Fin</label>
                    <div style={s.row}>
                      <select style={{ ...s.select, flex: 1 }} value={endH} onChange={e => setEndH(+e.target.value)}>
                        {HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}
                      </select>
                      <select style={{ ...s.select, flex: 1 }} value={endM} onChange={e => setEndM(+e.target.value)}>
                        {[0, 15, 30, 45].map(m => <option key={m} value={m}>{pad(m)}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
            {!isCustom && (
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
                Fin estimado: {endStr} ({selectedType?.duration} min)
              </div>
            )}
          </div>

          {!possibleAssignee && (
            <div style={s.warning}>
              ⚠ No hay persona disponible para esta cita. Se agendará sin asignar.
            </div>
          )}
          {possibleAssignee && (
            <div style={s.info}>
              Asignado a: {getUserName(possibleAssignee)}
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
              style={{ ...s.btn(COLORS.gold), opacity: saving ? 0.6 : 1 }}
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Agendar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Block Renderer ──────────────────────────────────────────────
  const renderBlocks = (dateStr, dayAvailData, dayBookData) => {
    const fAvail = filter === 'me' ? dayAvailData.filter(a => a.user_id === currentUser) : dayAvailData
    const fBook = filter === 'me' ? dayBookData.filter(b => b.assigned_to === currentUser) : dayBookData

    return HOURS.map(h => (
      <div key={h} style={{
        display: 'flex', alignItems: 'flex-start', minHeight: viewMode === 'week' ? 40 : 60,
        borderTop: `1px solid ${COLORS.border}`, position: 'relative',
      }}>
        {viewMode === 'day' && (
          <div style={{
            width: 48, fontSize: 11, color: COLORS.textMuted, paddingTop: 4, flexShrink: 0,
          }}>{pad(h)}:00</div>
        )}
        <div style={{ flex: 1, position: 'relative', minHeight: viewMode === 'week' ? 40 : 60 }}>
          {fAvail.filter(a => parseInt(a.start_time) === h).map(a => {
            const relTop = parseInt(a.start_time.split(':')[1]) || 0
            const top = (relTop / 60) * (viewMode === 'week' ? 40 : 60)
            const height = ((parseTime(a.end_time) - parseTime(a.start_time)) / 60) * (viewMode === 'week' ? 40 : 60)
            const color = getUserColor(a.user_id)
            return (
              <div key={a.id} onClick={() => setModal({ type: 'editAvail', data: a })}
                style={{
                  position: 'absolute', left: 2, right: 2, borderRadius: viewMode === 'week' ? 6 : 10,
                  padding: viewMode === 'week' ? '2px 4px' : '6px 10px',
                  fontSize: viewMode === 'week' ? 9 : 12, fontWeight: 500, cursor: 'pointer',
                  top, height: Math.max(height, viewMode === 'week' ? 16 : 24), overflow: 'hidden', zIndex: 2,
                  background: a.is_focus ? COLORS.focusLight : color + '22',
                  border: `1px solid ${a.is_focus ? COLORS.focus + '44' : color + '55'}`,
                  borderLeft: `3px solid ${a.is_focus ? COLORS.focus : color}`,
                  color: a.is_focus ? COLORS.focus : color,
                }}>
                <div style={{ fontSize: viewMode === 'week' ? 8 : 11, opacity: 0.9 }}>
                  {getUserName(a.user_id)}{a.is_focus ? ' · Focus' : ''}
                </div>
                {viewMode === 'day' && (
                  <div style={{ fontSize: 10, opacity: 0.6 }}>{a.start_time} – {a.end_time}</div>
                )}
              </div>
            )
          })}
          {fBook.filter(b => parseInt(b.start_time) === h).map(b => {
            const relTop = parseInt(b.start_time.split(':')[1]) || 0
            const top = (relTop / 60) * (viewMode === 'week' ? 40 : 60)
            const height = ((parseTime(b.end_time) - parseTime(b.start_time)) / 60) * (viewMode === 'week' ? 40 : 60)
            const has = !!b.assigned_to
            return (
              <div key={b.id} onClick={() => { setSelectedDate(new Date(b.date)); setViewMode('day'); setModal({ type: 'editBooking', data: b }) }}
                style={{
                  position: 'absolute', left: viewMode === 'week' ? '40%' : '35%', right: 2,
                  borderRadius: viewMode === 'week' ? 6 : 10,
                  padding: viewMode === 'week' ? '2px 4px' : '6px 10px',
                  fontSize: viewMode === 'week' ? 9 : 12, fontWeight: 500, cursor: 'pointer',
                  top, height: Math.max(height, viewMode === 'week' ? 16 : 28), overflow: 'hidden', zIndex: 3,
                  background: has ? COLORS.goldLight : COLORS.redLight,
                  border: `1px solid ${has ? COLORS.gold + '44' : COLORS.red + '44'}`,
                  borderLeft: `3px solid ${has ? COLORS.gold : COLORS.red}`,
                  color: has ? COLORS.gold : COLORS.red,
                }}>
                <div style={{ fontSize: viewMode === 'week' ? 8 : 11 }}>
                  {viewMode === 'week' ? b.client_name.split(' ')[0] : `${b.client_name} · ${b.type_name}`}
                </div>
                {viewMode === 'day' && (
                  <div style={{ fontSize: 10, opacity: 0.7 }}>
                    {b.start_time} – {b.end_time}
                    {b.assigned_to ? ` → ${getUserName(b.assigned_to)}` : ' · ⚠ Sin asignar'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    ))
  }

  // ─── Day Timeline ────────────────────────────────────────────────
  const renderDayTimeline = () => (
    <div style={{ padding: '0 12px 0 20px' }}>
      {renderBlocks(today, dayAvail, dayBooks)}
    </div>
  )

  // ─── Week View ───────────────────────────────────────────────────
  const renderWeekView = () => {
    const todayStr = dateKey(new Date())
    return (
      <div style={{ padding: '0 8px', overflowX: 'auto' }}>
        {/* Week header */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${COLORS.border}`, position: 'sticky', top: 52, background: COLORS.bg, zIndex: 10 }}>
          <div style={{ width: 0, flexShrink: 0 }} />
          {weekDates.map(d => {
            const dk = dateKey(d)
            const isToday = dk === todayStr
            const isSelected = dk === today
            return (
              <div key={dk} onClick={() => { setSelectedDate(d); setViewMode('day') }}
                style={{
                  flex: 1, textAlign: 'center', padding: '8px 2px', cursor: 'pointer',
                  fontSize: 11, fontWeight: isToday ? 600 : 400,
                  color: isToday ? COLORS.green : COLORS.textMuted,
                  borderBottom: isSelected ? `2px solid ${COLORS.green}` : '2px solid transparent',
                }}>
                <div>{formatDate(d).split(' ')[0]}</div>
                <div style={{
                  fontSize: 16, fontWeight: 500, color: isToday ? COLORS.white : COLORS.text,
                  background: isToday ? COLORS.green : 'transparent',
                  borderRadius: '50%', width: 28, height: 28, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', margin: '2px auto 0',
                }}>{d.getDate()}</div>
              </div>
            )
          })}
        </div>
        {/* Week grid */}
        <div style={{ display: 'flex' }}>
          {/* Hour labels */}
          <div style={{ width: 32, flexShrink: 0 }}>
            {HOURS.map(h => (
              <div key={h} style={{ height: 40, fontSize: 9, color: COLORS.textMuted, paddingTop: 2 }}>
                {pad(h)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          {weekDates.map(d => {
            const dk = dateKey(d)
            const dayA = availability.filter(a => a.date === dk)
            const dayB = bookings.filter(b => b.date === dk)
            return (
              <div key={dk} style={{
                flex: 1, borderLeft: `1px solid ${COLORS.border}`, minWidth: 0,
              }}>
                {renderBlocks(dk, dayA, dayB)}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────
  const user = INTERNAL_USERS.find(u => u.id === currentUser) || INTERNAL_USERS[3]

  return (
    <div style={{
      fontFamily: "'Poppins', sans-serif", background: COLORS.bg, color: COLORS.text,
      minHeight: '100vh', maxWidth: 900, margin: '0 auto', padding: '0 0 100px',
      fontSize: 14, fontWeight: 400,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 16px 10px', borderBottom: `1px solid ${COLORS.border}`,
        position: 'sticky', top: 0, background: COLORS.bg, zIndex: 50,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, color: COLORS.green, letterSpacing: '0.02em' }}>
            Fran Vega
          </div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 1 }}>Agenda interna</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px',
            borderRadius: 20, background: user.color + '18', color: user.color,
            fontSize: 12, fontWeight: 500, border: `1.5px solid ${user.color}33`,
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', background: user.color,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600,
            }}>{user.name[0]}</span>
            {user.name}
          </div>
          <button onClick={handleLogout} style={{
            background: 'transparent', border: `1px solid ${COLORS.border}`,
            borderRadius: '50%', width: 30, height: 30, cursor: 'pointer',
            fontSize: 13, color: COLORS.textMuted, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }} title="Salir">✕</button>
        </div>
      </div>

      {/* View Toggle + Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px 6px', gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['day', 'week'].map(v => (
            <div key={v} onClick={() => setViewMode(v)} style={{
              padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: viewMode === v ? COLORS.green : 'transparent',
              color: viewMode === v ? '#fff' : COLORS.textMuted,
              transition: 'all .2s',
            }}>
              {v === 'day' ? 'Día' : 'Semana'}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setSelectedDate(addDays(selectedDate, viewMode === 'week' ? -7 : -1))} style={{
            width: 32, height: 32, borderRadius: '50%', border: `1px solid ${COLORS.border}`,
            background: 'transparent', cursor: 'pointer', fontSize: 16, color: COLORS.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>‹</button>
          <div style={{ fontSize: 14, fontWeight: 500, minWidth: 140, textAlign: 'center' }}>
            {viewMode === 'day' ? formatDateLong(selectedDate) : `${formatDate(weekDates[0])} – ${formatDate(weekDates[6])}`}
          </div>
          <button onClick={() => setSelectedDate(addDays(selectedDate, viewMode === 'week' ? 7 : 1))} style={{
            width: 32, height: 32, borderRadius: '50%', border: `1px solid ${COLORS.border}`,
            background: 'transparent', cursor: 'pointer', fontSize: 16, color: COLORS.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>›</button>
          <button onClick={() => setSelectedDate(new Date())} style={{
            height: 32, borderRadius: 16, border: `1px solid ${COLORS.border}`,
            background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 500,
            color: COLORS.text, padding: '0 10px',
          }}>Hoy</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, padding: '2px 16px 8px' }}>
        {['all', 'me'].map(f => (
          <div key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            border: `1.5px solid ${filter === f ? COLORS.green : COLORS.border}`,
            background: filter === f ? COLORS.greenLight : 'transparent',
            color: filter === f ? COLORS.green : COLORS.textMuted,
          }}>
            {f === 'all' ? 'Todos' : 'Solo yo'}
          </div>
        ))}
      </div>

      {/* Summary (day view only) */}
      {viewMode === 'day' && (
        <div style={{ display: 'flex', gap: 5, padding: '4px 16px 8px', flexWrap: 'wrap' }}>
          {usersPresent.length === 0 && usersFocus.length === 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px',
              borderRadius: 10, background: COLORS.red + '14', fontSize: 10, fontWeight: 500, color: COLORS.red,
            }}>⚠ Showroom vacío</div>
          )}
          {usersPresent.map(uid => (
            <div key={uid} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px',
              borderRadius: 10, background: getUserColor(uid) + '18', fontSize: 10,
              fontWeight: 500, color: getUserColor(uid),
            }}>● {getUserName(uid)}</div>
          ))}
          {usersFocus.map(uid => (
            <div key={uid} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px',
              borderRadius: 10, background: COLORS.focus + '18', fontSize: 10,
              fontWeight: 500, color: COLORS.focus,
            }}>◐ {getUserName(uid)} Focus</div>
          ))}
          {unassignedBooks.length > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px',
              borderRadius: 10, background: COLORS.red + '14', fontSize: 10, fontWeight: 500, color: COLORS.red,
            }}>⚠ {unassignedBooks.length} sin asignar</div>
          )}
          {dayBooks.length > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px',
              borderRadius: 10, background: COLORS.gold + '14', fontSize: 10, fontWeight: 500, color: COLORS.gold,
            }}>{dayBooks.length} cita{dayBooks.length > 1 ? 's' : ''}</div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.textMuted }}>
          Cargando...
        </div>
      ) : viewMode === 'day' ? renderDayTimeline() : renderWeekView()}

      {/* FAB */}
      <button style={{
        position: 'fixed', bottom: 20, right: 20, width: 52, height: 52, borderRadius: '50%',
        background: COLORS.green, color: COLORS.white, border: 'none', fontSize: 26,
        cursor: 'pointer', boxShadow: '0 4px 20px rgba(3,70,71,0.3)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: fabOpen ? 'rotate(45deg)' : 'rotate(0)', transition: 'transform .2s',
      }} onClick={() => setFabOpen(!fabOpen)}>+</button>

      {fabOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setFabOpen(false)} />
          <div style={{
            position: 'fixed', bottom: 80, right: 20, display: 'flex',
            flexDirection: 'column', gap: 8, zIndex: 99,
          }}>
            <button onClick={() => { setFabOpen(false); setModal({ type: 'addAvail' }) }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              borderRadius: 12, background: COLORS.green, color: '#fff', fontSize: 13,
              fontWeight: 500, border: 'none', cursor: 'pointer',
              boxShadow: '0 2px 12px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
            }}>Agregar horario</button>
            <button onClick={() => { setFabOpen(false); setModal({ type: 'addBooking' }) }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              borderRadius: 12, background: COLORS.gold, color: '#fff', fontSize: 13,
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
        position: 'fixed', bottom: toast ? 90 : -60, left: '50%', transform: 'translateX(-50%)',
        background: COLORS.green, color: '#fff', padding: '10px 24px', borderRadius: 12,
        fontSize: 13, fontWeight: 500, zIndex: 300, transition: 'bottom .3s ease',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
      }}>
        {toast}
      </div>
    </div>
  )
}
