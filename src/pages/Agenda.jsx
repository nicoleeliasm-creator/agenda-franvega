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
const HOUR_H = 64 // px per hour in day view
const HOUR_H_WEEK = 44 // px per hour in week view

// ─── Helpers ─────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
const formatDateShort = (d) => {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  return `${days[d.getDay()]} ${d.getDate()}`
}
const formatDateLong = (d) => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}
const formatWeekRange = (dates) => {
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const s = dates[0], e = dates[6]
  if (s.getMonth() === e.getMonth()) return `${s.getDate()} – ${e.getDate()} ${months[s.getMonth()]}`
  return `${s.getDate()} ${months[s.getMonth()]} – ${e.getDate()} ${months[e.getMonth()]}`
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
  if (!email) return 'nicole'
  const e = email.toLowerCase()
  if (e.includes('encargos')) return 'fran'
  if (e.includes('marketing')) return 'paci'
  if (e.includes('contacto')) return 'anto'
  if (e.includes('nicole')) return 'nicole'
  // fallback partial matches
  if (e.includes('fran')) return 'fran'
  if (e.includes('paci')) return 'paci'
  if (e.includes('anto')) return 'anto'
  return 'nicole'
}

// Layout: compute side-by-side positions for overlapping blocks
const layoutBlocks = (blocks) => {
  if (!blocks.length) return []
  const sorted = [...blocks].sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time))
  const result = sorted.map(b => ({ ...b, col: 0, totalCols: 1 }))
  const columns = []
  for (const block of result) {
    const bStart = parseTime(block.start_time)
    let placed = false
    for (let c = 0; c < columns.length; c++) {
      const lastEnd = columns[c]
      if (bStart >= lastEnd) {
        block.col = c
        columns[c] = parseTime(block.end_time)
        placed = true
        break
      }
    }
    if (!placed) {
      block.col = columns.length
      columns.push(parseTime(block.end_time))
    }
  }
  const totalCols = columns.length
  result.forEach(b => { b.totalCols = totalCols })
  return result
}

// ─── Main Component ──────────────────────────────────────────────────
export default function Agenda({ session }) {
  const currentUser = emailToUserId(session?.user?.email)

  const [selectedDate, setSelectedDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('day')
  const [filter, setFilter] = useState('all')
  const [availability, setAvailability] = useState([])
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [fabOpen, setFabOpen] = useState(false)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const today = dateKey(selectedDate)
  const weekDates = useMemo(() => {
    const mon = getMonday(selectedDate)
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  }, [selectedDate])

  // ─── Data Loading ────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    let dateFilter
    if (viewMode === 'day') {
      dateFilter = { start: today, end: today }
    } else {
      dateFilter = { start: dateKey(weekDates[0]), end: dateKey(weekDates[6]) }
    }
    const [availRes, bookRes] = await Promise.all([
      supabase.from('availability').select('*').gte('date', dateFilter.start).lte('date', dateFilter.end),
      supabase.from('bookings').select('*').gte('date', dateFilter.start).lte('date', dateFilter.end).neq('status', 'cancelled'),
    ])
    setAvailability(availRes.data || [])
    setBookings(bookRes.data || [])
    setLoading(false)
  }, [today, viewMode, weekDates])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const ch = supabase.channel('changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [loadData])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  // ─── Day data ────────────────────────────────────────────────────
  const dayAvail = availability.filter(a => a.date === today)
  const dayBooks = bookings.filter(b => b.date === today)
  const usersPresent = [...new Set(dayAvail.filter(a => !a.is_focus).map(a => a.user_id))]
  const usersFocus = [...new Set(dayAvail.filter(a => a.is_focus).map(a => a.user_id))]
  const unassignedBooks = dayBooks.filter(b => !b.assigned_to)

  // ─── Logic ───────────────────────────────────────────────────────
  const findAssignee = (date, startTime, endTime, typeId) => {
    const dateAvail = availability.filter(a => a.date === date && !a.is_focus)
    const eligible = dateAvail.filter(a => {
      return parseTime(a.start_time) <= parseTime(startTime) && parseTime(a.end_time) >= parseTime(endTime) && canUserDoType(a.user_id, typeId)
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

  const wouldExceedMax = (date, startTime, endTime, userId, excludeId) => {
    const dateAvail = availability.filter(a => a.date === date && a.id !== excludeId)
    const s = parseTime(startTime), e = parseTime(endTime)
    for (let t = s; t < e; t += 15) {
      const users = new Set()
      dateAvail.forEach(a => { if (parseTime(a.start_time) <= t && parseTime(a.end_time) > t) users.add(a.user_id) })
      users.add(userId)
      if (users.size > 2) return true
    }
    return false
  }

  const checkConflict = (availId) => {
    const avail = availability.find(a => a.id === availId)
    if (!avail) return []
    const aS = parseTime(avail.start_time), aE = parseTime(avail.end_time)
    return bookings.filter(b => b.date === avail.date).filter(b => {
      const bS = parseTime(b.start_time), bE = parseTime(b.end_time)
      if (!(bS < aE && bE > aS)) return false
      const others = availability.filter(a2 => a2.id !== availId && !a2.is_focus && a2.user_id !== avail.user_id && a2.date === avail.date)
      return !others.some(a2 => parseTime(a2.start_time) <= bS && parseTime(a2.end_time) >= bE && canUserDoType(a2.user_id, b.type_id))
    })
  }

  // ─── Handlers ────────────────────────────────────────────────────
  const handleSaveAvailability = async (form) => {
    const startTime = timeStr(form.startH, form.startM), endTime = timeStr(form.endH, form.endM)
    if (parseTime(endTime) <= parseTime(startTime)) return 'La hora de fin debe ser después del inicio'
    const targetDate = form.date || today
    if (wouldExceedMax(targetDate, startTime, endTime, form.userId, form.editId)) return 'Máximo 2 personas en showroom a la vez'
    const record = { user_id: form.userId, date: targetDate, start_time: startTime, end_time: endTime, is_focus: form.isFocus }
    if (form.editId) await supabase.from('availability').update(record).eq('id', form.editId)
    else await supabase.from('availability').insert(record)
    setModal(null); showToast(form.editId ? 'Horario actualizado' : 'Horario agregado'); loadData()
    return null
  }

  const handleDeleteAvailability = async (id) => {
    const conflicts = checkConflict(id)
    if (conflicts.length > 0) { setConfirmDelete({ id, conflicts }); return }
    await supabase.from('availability').delete().eq('id', id)
    setModal(null); showToast('Horario eliminado'); loadData()
  }

  const confirmDeleteAvail = async () => {
    if (!confirmDelete) return
    for (const b of confirmDelete.conflicts) await supabase.from('bookings').update({ assigned_to: null }).eq('id', b.id)
    await supabase.from('availability').delete().eq('id', confirmDelete.id)
    setConfirmDelete(null); setModal(null); showToast('Eliminado · Clientes sin asignar'); loadData()
  }

  const handleSaveBooking = async (form) => {
    const type = APPOINTMENT_TYPES.find(t => t.id === form.typeId)
    const startTime = timeStr(form.startH, form.startM)
    let endTime
    if (form.typeId === 'custom') {
      endTime = timeStr(form.endH, form.endM)
      if (parseTime(endTime) <= parseTime(startTime)) return 'La hora de fin debe ser después del inicio'
    } else {
      const endMin = parseTime(startTime) + type.duration
      endTime = timeStr(Math.floor(endMin / 60), endMin % 60)
      if (endMin > 20 * 60) return 'La cita excede el horario (20:00)'
    }
    if (!form.clientName.trim()) return 'Ingresa el nombre del cliente'
    const targetDate = form.date || today
    const assignee = findAssignee(targetDate, startTime, endTime, form.typeId)
    const record = {
      date: targetDate, type_id: form.typeId, type_name: form.typeId === 'custom' ? (form.customLabel || 'Otro') : type.label,
      start_time: startTime, end_time: endTime, client_name: form.clientName,
      client_phone: form.clientPhone, client_email: form.clientEmail, assigned_to: assignee, status: 'confirmed',
    }
    if (form.editId) await supabase.from('bookings').update(record).eq('id', form.editId)
    else await supabase.from('bookings').insert(record)
    setModal(null); showToast(assignee ? `Agendado → ${getUserName(assignee)}` : '⚠ Sin persona asignada'); loadData()
    return null
  }

  const handleDeleteBooking = async (id) => {
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    setModal(null); showToast('Cita eliminada'); loadData()
  }

  const handleLogout = async () => { await supabase.auth.signOut() }

  // ─── Shared Styles ───────────────────────────────────────────────
  const sModal = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
    box: { background: COLORS.white, borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '85vh', overflow: 'auto', padding: '24px 20px 32px', animation: 'slideUp .3s ease' },
    title: { fontSize: 17, fontWeight: 500, marginBottom: 20, color: COLORS.green },
    label: { fontSize: 12, fontWeight: 500, color: COLORS.textMuted, marginBottom: 6, display: 'block' },
    input: { width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${COLORS.border}`, fontSize: 14, fontFamily: "'Poppins',sans-serif", background: COLORS.bg, color: COLORS.text, boxSizing: 'border-box' },
    select: { width: '100%', padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${COLORS.border}`, fontSize: 14, fontFamily: "'Poppins',sans-serif", background: COLORS.bg, color: COLORS.text, boxSizing: 'border-box', appearance: 'none' },
    btn: (bg, clr='#fff') => ({ padding: '12px 24px', borderRadius: 12, background: bg, color: clr, border: 'none', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'Poppins',sans-serif", width: '100%' }),
    btnDel: { padding: '12px 24px', borderRadius: 12, background: 'transparent', color: COLORS.red, border: `1.5px solid ${COLORS.red}33`, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: "'Poppins',sans-serif", width: '100%' },
    fg: { marginBottom: 16 },
    row: { display: 'flex', gap: 10 },
    error: { background: COLORS.redLight, border: `1.5px solid ${COLORS.red}44`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.red, fontWeight: 500, marginBottom: 16 },
    info: { background: COLORS.greenLight, border: `1.5px solid ${COLORS.green}44`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.green, fontWeight: 500, marginBottom: 16 },
    warning: { background: COLORS.orangeLight, border: `1.5px solid ${COLORS.orange}44`, borderRadius: 10, padding: '10px 14px', fontSize: 12, color: COLORS.orange, fontWeight: 500, marginBottom: 16 },
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

    const save = async () => {
      setError(''); setSaving(true)
      const r = await handleSaveAvailability({ userId, startH, startM, endH, endM, isFocus, editId: data?.id, date: data?.date })
      if (r) { setError(r); setSaving(false) }
    }

    return (
      <div style={sModal.overlay} onClick={() => setModal(null)}>
        <div style={sModal.box} onClick={e => e.stopPropagation()}>
          <div style={sModal.title}>{isEdit ? 'Editar horario' : 'Agregar horario'}</div>
          {error && <div style={sModal.error}>{error}</div>}
          <div style={sModal.fg}>
            <label style={sModal.label}>Persona</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {INTERNAL_USERS.filter(u => u.id !== 'nicole').map(u => (
                <div key={u.id} onClick={() => setUserId(u.id)} style={{
                  flex: 1, padding: '10px 6px', borderRadius: 10, textAlign: 'center', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `2px solid ${userId === u.id ? u.color : COLORS.border}`, background: userId === u.id ? u.color + '14' : 'transparent',
                  color: userId === u.id ? u.color : COLORS.textMuted,
                }}>{u.name}</div>
              ))}
            </div>
          </div>
          <div style={sModal.fg}>
            <div style={sModal.row}>
              <div style={{ flex: 1 }}>
                <label style={sModal.label}>Inicio</label>
                <div style={sModal.row}>
                  <select style={{ ...sModal.select, flex: 1 }} value={startH} onChange={e => setStartH(+e.target.value)}>{HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}</select>
                  <select style={{ ...sModal.select, flex: 1 }} value={startM} onChange={e => setStartM(+e.target.value)}>{[0,15,30,45].map(m => <option key={m} value={m}>{pad(m)}</option>)}</select>
                </div>
              </div>
              <span style={{ marginTop: 22, color: COLORS.textMuted }}>—</span>
              <div style={{ flex: 1 }}>
                <label style={sModal.label}>Fin</label>
                <div style={sModal.row}>
                  <select style={{ ...sModal.select, flex: 1 }} value={endH} onChange={e => setEndH(+e.target.value)}>{HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}</select>
                  <select style={{ ...sModal.select, flex: 1 }} value={endM} onChange={e => setEndM(+e.target.value)}>{[0,15,30,45].map(m => <option key={m} value={m}>{pad(m)}</option>)}</select>
                </div>
              </div>
            </div>
          </div>
          <div style={sModal.fg}>
            <div onClick={() => setIsFocus(!isFocus)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
              border: `1.5px solid ${isFocus ? COLORS.focus+'66' : COLORS.border}`, background: isFocus ? COLORS.focusLight : 'transparent',
            }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isFocus ? COLORS.focus : COLORS.border}`, background: isFocus ? COLORS.focus : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{isFocus ? '✓' : ''}</div>
              <span style={{ fontSize: 13, fontWeight: 500, color: isFocus ? COLORS.focus : COLORS.textMuted }}>Focus Time (no atiende clientes)</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {isEdit && <button style={sModal.btnDel} onClick={() => handleDeleteAvailability(data.id)}>Eliminar</button>}
            <button style={{ ...sModal.btn(COLORS.green), opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>{saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Agregar'}</button>
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
    const endStr = isCustom ? timeStr(endH, endM) : (() => { const m = startH*60+startM+(selectedType?.duration||0); return timeStr(Math.floor(m/60),m%60) })()
    const targetDate = data?.date || today
    const possibleAssignee = findAssignee(targetDate, timeStr(startH, startM), endStr, typeId)

    const restrictionInfo = useMemo(() => {
      if (isCustom) return null
      const t = APPOINTMENT_TYPES.find(t => t.id === typeId)
      if (!t?.restrictions.length) return null
      return `${t.restrictions.map(r => getUserName(r)).join(', ')} no puede atender este tipo`
    }, [typeId, isCustom])

    const save = async () => {
      setError(''); setSaving(true)
      const r = await handleSaveBooking({ typeId, startH, startM, endH, endM, clientName, clientPhone, clientEmail, customLabel, editId: data?.id, date: data?.date })
      if (r) { setError(r); setSaving(false) }
    }

    return (
      <div style={sModal.overlay} onClick={() => setModal(null)}>
        <div style={sModal.box} onClick={e => e.stopPropagation()}>
          <div style={sModal.title}>{isEdit ? 'Editar cita' : 'Agendar cliente'}</div>
          {error && <div style={sModal.error}>{error}</div>}
          <div style={sModal.fg}>
            <label style={sModal.label}>Tipo de cita</label>
            <select style={sModal.select} value={typeId} onChange={e => setTypeId(e.target.value)}>
              {APPOINTMENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}{t.duration ? ` (${t.duration} min)` : ''}</option>)}
            </select>
          </div>
          {isCustom && <div style={sModal.fg}><label style={sModal.label}>Descripción</label><input style={sModal.input} placeholder="Ej: Revisión, Consulta..." value={customLabel} onChange={e => setCustomLabel(e.target.value)} /></div>}
          {restrictionInfo && <div style={sModal.warning}>{restrictionInfo}</div>}
          <div style={sModal.fg}>
            <div style={sModal.row}>
              <div style={{ flex: 1 }}>
                <label style={sModal.label}>Inicio</label>
                <div style={sModal.row}>
                  <select style={{ ...sModal.select, flex: 1 }} value={startH} onChange={e => setStartH(+e.target.value)}>{HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}</select>
                  <select style={{ ...sModal.select, flex: 1 }} value={startM} onChange={e => setStartM(+e.target.value)}>{[0,15,30,45].map(m => <option key={m} value={m}>{pad(m)}</option>)}</select>
                </div>
              </div>
              {isCustom && <>
                <span style={{ marginTop: 22, color: COLORS.textMuted }}>—</span>
                <div style={{ flex: 1 }}>
                  <label style={sModal.label}>Fin</label>
                  <div style={sModal.row}>
                    <select style={{ ...sModal.select, flex: 1 }} value={endH} onChange={e => setEndH(+e.target.value)}>{HOURS.map(h => <option key={h} value={h}>{pad(h)}</option>)}</select>
                    <select style={{ ...sModal.select, flex: 1 }} value={endM} onChange={e => setEndM(+e.target.value)}>{[0,15,30,45].map(m => <option key={m} value={m}>{pad(m)}</option>)}</select>
                  </div>
                </div>
              </>}
            </div>
            {!isCustom && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>Fin: {endStr} ({selectedType?.duration} min)</div>}
          </div>
          {!possibleAssignee && <div style={sModal.warning}>⚠ No hay persona disponible. Se agendará sin asignar.</div>}
          {possibleAssignee && <div style={sModal.info}>Asignado a: {getUserName(possibleAssignee)}</div>}
          <div style={sModal.fg}><label style={sModal.label}>Nombre del cliente</label><input style={sModal.input} placeholder="Nombre" value={clientName} onChange={e => setClientName(e.target.value)} /></div>
          <div style={sModal.fg}><label style={sModal.label}>Teléfono (WhatsApp)</label><input style={sModal.input} placeholder="+56 9 1234 5678" value={clientPhone} onChange={e => setClientPhone(e.target.value)} /></div>
          <div style={sModal.fg}><label style={sModal.label}>Email</label><input style={sModal.input} placeholder="cliente@email.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} type="email" /></div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            {isEdit && <button style={sModal.btnDel} onClick={() => handleDeleteBooking(data.id)}>Eliminar</button>}
            <button style={{ ...sModal.btn(COLORS.gold), opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>{saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Agendar'}</button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Timeline Renderer (used for both day & week columns) ──────
  const renderColumn = (dateStr, isWeek = false) => {
    const hh = isWeek ? HOUR_H_WEEK : HOUR_H
    const colAvail = availability.filter(a => a.date === dateStr)
    const colBooks = bookings.filter(b => b.date === dateStr)
    const fAvail = filter === 'me' ? colAvail.filter(a => a.user_id === currentUser) : colAvail
    const fBooks = filter === 'me' ? colBooks.filter(b => b.assigned_to === currentUser) : colBooks

    // Layout avail blocks side by side
    const laidAvail = layoutBlocks(fAvail)

    return (
      <div style={{ position: 'relative', height: HOURS.length * hh }}>
        {/* Hour lines */}
        {HOURS.map((h, i) => (
          <div key={h} style={{ position: 'absolute', top: i * hh, left: 0, right: 0, height: hh, borderTop: `1px solid ${COLORS.border}` }} />
        ))}
        {/* Availability blocks */}
        {laidAvail.map(a => {
          const top = ((parseTime(a.start_time) - 480) / 60) * hh
          const height = ((parseTime(a.end_time) - parseTime(a.start_time)) / 60) * hh
          const color = getUserColor(a.user_id)
          const widthPct = 100 / a.totalCols
          const leftPct = a.col * widthPct
          return (
            <div key={a.id} onClick={() => setModal({ type: 'editAvail', data: a })} style={{
              position: 'absolute', top, height: Math.max(height, isWeek ? 14 : 22),
              left: `${leftPct}%`, width: `${widthPct}%`, padding: isWeek ? '1px 3px' : '4px 8px',
              boxSizing: 'border-box', cursor: 'pointer', zIndex: 2,
            }}>
              <div style={{
                height: '100%', borderRadius: isWeek ? 5 : 8, overflow: 'hidden',
                background: a.is_focus ? COLORS.focusLight : color + '1a',
                border: `1px solid ${a.is_focus ? COLORS.focus + '44' : color + '44'}`,
                borderLeft: `3px solid ${a.is_focus ? COLORS.focus : color}`,
                padding: isWeek ? '2px 4px' : '5px 8px',
                color: a.is_focus ? COLORS.focus : color,
              }}>
                <div style={{ fontSize: isWeek ? 8 : 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {getUserName(a.user_id)}{a.is_focus ? ' · Focus' : ''}
                </div>
                {!isWeek && <div style={{ fontSize: 10, opacity: 0.6 }}>{a.start_time} – {a.end_time}</div>}
              </div>
            </div>
          )
        })}
        {/* Booking blocks */}
        {fBooks.map(b => {
          const top = ((parseTime(b.start_time) - 480) / 60) * hh
          const height = ((parseTime(b.end_time) - parseTime(b.start_time)) / 60) * hh
          const has = !!b.assigned_to
          const assignedColor = has ? getUserColor(b.assigned_to) : COLORS.red
          return (
            <div key={b.id} onClick={() => { if (isWeek) { setSelectedDate(new Date(b.date + 'T12:00:00')); setViewMode('day') } setModal({ type: 'editBooking', data: b }) }} style={{
              position: 'absolute', top, height: Math.max(height, isWeek ? 14 : 26),
              left: 0, right: 0, padding: isWeek ? '1px 3px' : '4px 8px',
              boxSizing: 'border-box', cursor: 'pointer', zIndex: 4,
            }}>
              <div style={{
                height: '100%', borderRadius: isWeek ? 5 : 8, overflow: 'hidden',
                background: has ? assignedColor + '18' : COLORS.redLight,
                border: `1px solid ${has ? assignedColor + '55' : COLORS.red + '44'}`,
                borderLeft: `3px solid ${has ? assignedColor : COLORS.red}`,
                padding: isWeek ? '2px 4px' : '5px 8px',
                color: has ? assignedColor : COLORS.red,
              }}>
                <div style={{ fontSize: isWeek ? 8 : 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {isWeek ? b.client_name.split(' ')[0] : `${b.client_name} · ${b.type_name}`}
                </div>
                {!isWeek && <div style={{ fontSize: 10, opacity: 0.7 }}>
                  {b.start_time} – {b.end_time}{has ? ` → ${getUserName(b.assigned_to)}` : ' · ⚠ Sin asignar'}
                </div>}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // ─── Day View ────────────────────────────────────────────────────
  const renderDayView = () => (
    <div style={{ display: 'flex', padding: '0 12px 0 4px' }}>
      {/* Hour labels */}
      <div style={{ width: 48, flexShrink: 0 }}>
        {HOURS.map((h, i) => (
          <div key={h} style={{ height: HOUR_H, fontSize: 11, color: COLORS.textMuted, paddingTop: 4, paddingLeft: 8 }}>{pad(h)}:00</div>
        ))}
      </div>
      {/* Timeline column */}
      <div style={{ flex: 1 }}>{renderColumn(today, false)}</div>
    </div>
  )

  // ─── Week View ───────────────────────────────────────────────────
  const renderWeekView = () => {
    const todayStr = dateKey(new Date())
    return (
      <div style={{ overflowX: 'auto', padding: '0 4px' }}>
        <div style={{ display: 'flex', minWidth: 600 }}>
          {/* Hour labels */}
          <div style={{ width: 32, flexShrink: 0 }}>
            <div style={{ height: 52 }} />
            {HOURS.map(h => (
              <div key={h} style={{ height: HOUR_H_WEEK, fontSize: 9, color: COLORS.textMuted, paddingTop: 2, textAlign: 'right', paddingRight: 4 }}>{pad(h)}</div>
            ))}
          </div>
          {/* Day columns */}
          {weekDates.map(d => {
            const dk = dateKey(d)
            const isToday = dk === todayStr
            return (
              <div key={dk} style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${COLORS.border}` }}>
                {/* Day header */}
                <div onClick={() => { setSelectedDate(d); setViewMode('day') }} style={{
                  textAlign: 'center', padding: '6px 2px 8px', cursor: 'pointer',
                  borderBottom: `1px solid ${COLORS.border}`, background: isToday ? COLORS.green + '08' : 'transparent',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: isToday ? COLORS.green : COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]}
                  </div>
                  <div style={{
                    fontSize: 16, fontWeight: 600, marginTop: 2,
                    color: isToday ? COLORS.white : COLORS.text,
                    background: isToday ? COLORS.green : 'transparent',
                    borderRadius: '50%', width: 30, height: 30,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{d.getDate()}</div>
                </div>
                {/* Column */}
                {renderColumn(dk, true)}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ─── Main Render ─────────────────────────────────────────────────
  const user = INTERNAL_USERS.find(u => u.id === currentUser) || INTERNAL_USERS[3]

  return (
    <div style={{ fontFamily: "'Poppins',sans-serif", background: COLORS.bg, color: COLORS.text, minHeight: '100vh', maxWidth: 960, margin: '0 auto', padding: '0 0 100px', fontSize: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: `1px solid ${COLORS.border}`, position: 'sticky', top: 0, background: COLORS.bg, zIndex: 50 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, color: COLORS.green }}>Fran Vega</div>
          <div style={{ fontSize: 10, color: COLORS.textMuted }}>Agenda interna</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20, background: user.color + '18', color: user.color, fontSize: 12, fontWeight: 500, border: `1.5px solid ${user.color}33` }}>
            <span style={{ width: 22, height: 22, borderRadius: '50%', background: user.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600 }}>{user.name[0]}</span>
            {user.name}
          </div>
          <button onClick={handleLogout} style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', fontSize: 13, color: COLORS.textMuted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 4px', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0, background: COLORS.border, borderRadius: 20, padding: 2 }}>
          {['day', 'week'].map(v => (
            <div key={v} onClick={() => setViewMode(v)} style={{
              padding: '5px 16px', borderRadius: 18, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: viewMode === v ? COLORS.green : 'transparent', color: viewMode === v ? '#fff' : COLORS.textMuted,
            }}>{v === 'day' ? 'Día' : 'Semana'}</div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setSelectedDate(addDays(selectedDate, viewMode === 'week' ? -7 : -1))} style={{ width: 30, height: 30, borderRadius: '50%', border: `1px solid ${COLORS.border}`, background: 'transparent', cursor: 'pointer', fontSize: 15, color: COLORS.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <div style={{ fontSize: 13, fontWeight: 500, minWidth: 120, textAlign: 'center' }}>
            {viewMode === 'day' ? formatDateLong(selectedDate) : formatWeekRange(weekDates)}
          </div>
          <button onClick={() => setSelectedDate(addDays(selectedDate, viewMode === 'week' ? 7 : 1))} style={{ width: 30, height: 30, borderRadius: '50%', border: `1px solid ${COLORS.border}`, background: 'transparent', cursor: 'pointer', fontSize: 15, color: COLORS.text, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          <button onClick={() => setSelectedDate(new Date())} style={{ height: 30, borderRadius: 16, border: `1px solid ${COLORS.border}`, background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 500, color: COLORS.text, padding: '0 10px' }}>Hoy</button>
        </div>
      </div>

      {/* Filter + Summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 16px 8px', flexWrap: 'wrap' }}>
        {['all', 'me'].map(f => (
          <div key={f} onClick={() => setFilter(f)} style={{
            padding: '3px 12px', borderRadius: 14, fontSize: 11, fontWeight: 500, cursor: 'pointer',
            border: `1.5px solid ${filter === f ? COLORS.green : COLORS.border}`,
            background: filter === f ? COLORS.greenLight : 'transparent', color: filter === f ? COLORS.green : COLORS.textMuted,
          }}>{f === 'all' ? 'Todos' : 'Solo yo'}</div>
        ))}
        <div style={{ width: 1, height: 16, background: COLORS.border, margin: '0 4px' }} />
        {viewMode === 'day' && <>
          {usersPresent.length === 0 && usersFocus.length === 0 && <span style={{ fontSize: 10, color: COLORS.red, fontWeight: 500 }}>⚠ Showroom vacío</span>}
          {usersPresent.map(uid => <span key={uid} style={{ fontSize: 10, fontWeight: 500, color: getUserColor(uid), background: getUserColor(uid)+'14', padding: '1px 8px', borderRadius: 10 }}>● {getUserName(uid)}</span>)}
          {usersFocus.map(uid => <span key={uid} style={{ fontSize: 10, fontWeight: 500, color: COLORS.focus, background: COLORS.focus+'14', padding: '1px 8px', borderRadius: 10 }}>◐ {getUserName(uid)}</span>)}
          {unassignedBooks.length > 0 && <span style={{ fontSize: 10, fontWeight: 500, color: COLORS.red, background: COLORS.red+'14', padding: '1px 8px', borderRadius: 10 }}>⚠ {unassignedBooks.length} sin asignar</span>}
          {dayBooks.length > 0 && <span style={{ fontSize: 10, fontWeight: 500, color: COLORS.gold, background: COLORS.gold+'14', padding: '1px 8px', borderRadius: 10 }}>{dayBooks.length} cita{dayBooks.length > 1 ? 's' : ''}</span>}
        </>}
      </div>

      {/* Content */}
      {loading ? <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.textMuted }}>Cargando...</div>
        : viewMode === 'day' ? renderDayView() : renderWeekView()}

      {/* FAB */}
      <button style={{ position: 'fixed', bottom: 20, right: 20, width: 52, height: 52, borderRadius: '50%', background: COLORS.green, color: '#fff', border: 'none', fontSize: 26, cursor: 'pointer', boxShadow: '0 4px 20px rgba(3,70,71,0.3)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: fabOpen ? 'rotate(45deg)' : 'rotate(0)', transition: 'transform .2s' }} onClick={() => setFabOpen(!fabOpen)}>+</button>
      {fabOpen && <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setFabOpen(false)} />
        <div style={{ position: 'fixed', bottom: 80, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 99 }}>
          <button onClick={() => { setFabOpen(false); setModal({ type: 'addAvail' }) }} style={{ padding: '10px 16px', borderRadius: 12, background: COLORS.green, color: '#fff', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>Agregar horario</button>
          <button onClick={() => { setFabOpen(false); setModal({ type: 'addBooking' }) }} style={{ padding: '10px 16px', borderRadius: 12, background: COLORS.gold, color: '#fff', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>Agendar cliente</button>
        </div>
      </>}

      {/* Modals */}
      {modal?.type === 'addAvail' && <AvailModal data={null} />}
      {modal?.type === 'editAvail' && <AvailModal data={modal.data} />}
      {modal?.type === 'addBooking' && <BookModal data={null} />}
      {modal?.type === 'editBooking' && <BookModal data={modal.data} />}

      {/* Confirm Delete */}
      {confirmDelete && (
        <div style={sModal.overlay} onClick={() => setConfirmDelete(null)}>
          <div style={{ ...sModal.box, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={sModal.title}>⚠ Hay clientes en este horario</div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>Si eliminas, estos clientes quedarán sin persona:</div>
            {confirmDelete.conflicts.map(b => <div key={b.id} style={{ padding: '8px 12px', background: COLORS.redLight, borderRadius: 8, marginBottom: 6, fontSize: 13, color: COLORS.red }}>{b.client_name} · {b.type_name} · {b.start_time}</div>)}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button style={sModal.btn(COLORS.border, COLORS.text)} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button style={sModal.btn(COLORS.red)} onClick={confirmDeleteAvail}>Eliminar igual</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div style={{ position: 'fixed', bottom: toast ? 90 : -60, left: '50%', transform: 'translateX(-50%)', background: COLORS.green, color: '#fff', padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 500, zIndex: 300, transition: 'bottom .3s ease', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap' }}>{toast}</div>
    </div>
  )
}
