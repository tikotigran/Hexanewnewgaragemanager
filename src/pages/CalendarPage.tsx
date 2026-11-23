import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar as CalendarIcon, CheckCircle2, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useI18n } from '../context/I18nContext';
import { translateValue } from '../i18n/translations';
import { useToast } from '../context/ToastContext';
import type { CalendarEvent, TaskItem, Vehicle } from '../types';
import {
  Button,
  Card,
  FieldLabel,
  Input,
  Modal,
  Select,
  StatusLabel,
  TableSkeleton,
  Textarea,
} from '../components/ui/Primitives';

export const CalendarPage: React.FC = () => {
  const { t, date } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<'month' | 'week' | 'day' | 'list'>('list');
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  // Event form
  const [evTitle, setEvTitle] = useState('');
  const [evType, setEvType] = useState<'rdv_client' | 'achat' | 'vente' | 'inspection' | 'reparation' | 'controle_technique' | 'rappel'>('rdv_client');
  const [evVehicleId, setEvVehicleId] = useState('');
  const [evStart, setEvStart] = useState(`${new Date().toISOString().slice(0, 10)}T14:00`);
  const [evLocation, setEvLocation] = useState('');
  const [evDesc, setEvDesc] = useState('');

  // Task form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskVehicleId, setTaskVehicleId] = useState('');
  const [taskDue, setTaskDue] = useState(new Date().toISOString().slice(0, 10));
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');

  const { data, isLoading } = useQuery({
    queryKey: ['calendar'],
    queryFn: () => apiFetch<{ events: CalendarEvent[]; tasks: TaskItem[] }>('/api/calendar'),
  });

  const { data: vehData } = useQuery({
    queryKey: ['vehicles-cal-select'],
    queryFn: () => apiFetch<{ vehicles: Vehicle[] }>('/api/vehicles?limit=100'),
  });

  const events = data?.events || [];
  const tasks = data?.tasks || [];

  const filteredEvents = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (view === 'day') return events.filter((e) => e.start_at.slice(0, 10) === today);
    if (view === 'week') {
      const limit = new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10);
      return events.filter((e) => e.start_at.slice(0, 10) >= today && e.start_at.slice(0, 10) <= limit);
    }
    return events;
  }, [events, view]);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/calendar/events', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: evVehicleId ? Number(evVehicleId) : null,
          event_type: evType,
          title: evTitle,
          description: evDesc,
          start_at: evStart,
          location: evLocation,
        }),
      });
      toast(t('cal.eventAddedToast'), 'success');
      setEventModalOpen(false);
      setEvTitle('');
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const handleEventStatus = async (id: number, status: 'termine' | 'annule') => {
    await apiFetch(`/api/calendar/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: taskVehicleId ? Number(taskVehicleId) : null,
          title: taskTitle,
          due_date: taskDue || null,
          priority: taskPriority,
        }),
      });
      toast(t('cal.taskAddedToast'), 'success');
      setTaskModalOpen(false);
      setTaskTitle('');
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (err) {
      toast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const handleTaskStatus = async (id: number, status: 'todo' | 'in_progress' | 'done') => {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    qc.invalidateQueries({ queryKey: ['calendar'] });
  };

  const prioLabel = (p: string) =>
    p === 'high' ? t('cal.prioHigh') : p === 'low' ? t('cal.prioLow') : t('cal.prioMedium');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#151922] dark:text-white font-display">{t('nav.calendar')}</h1>
          <p className="text-sm text-[#7A8290] mt-0.5">{t('cal.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-[#E7EAF0] dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-[#111827] text-xs font-medium">
            {(['day', 'week', 'month', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-2 ${view === v ? 'bg-[#2563EB] text-white' : 'text-[#7A8290]'}`}
              >
                {v === 'day'
                  ? t('cal.viewDay')
                  : v === 'week'
                    ? t('cal.viewWeek')
                    : v === 'month'
                      ? t('cal.viewMonth')
                      : t('cal.viewList')}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setTaskModalOpen(true)}>
            <Plus className="w-4 h-4" />
            {t('cal.newTaskBtn')}
          </Button>
          <Button onClick={() => setEventModalOpen(true)}>
            <Plus className="w-4 h-4" />
            {t('cal.newEventBtn')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card><TableSkeleton rows={5} /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 lg:col-span-2 space-y-4">
            <h2 className="text-sm font-semibold font-display flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-[#2563EB]" />
              {t('cal.eventsTitle', { count: filteredEvents.length })}
            </h2>
            {filteredEvents.length === 0 ? (
              <p className="text-sm text-[#7A8290]">{t('cal.noEventsView')}</p>
            ) : (
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
                {filteredEvents.map((ev) => (
                  <div key={ev.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {ev.title} {ev.marque ? `· ${ev.marque} ${ev.modele}` : ''}
                      </div>
                      <div className="text-xs text-[#7A8290] mt-0.5">
                        {ev.start_at.replace('T', ' ').slice(0, 16)} · {translateValue(t, 'evType', ev.event_type)}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusLabel
                        tone={ev.status === 'termine' ? 'green' : ev.status === 'annule' ? 'neutral' : 'blue'}
                        label={translateValue(t, 'evStatus', ev.status)}
                      />
                      {ev.status === 'planifie' && (
                        <Button variant="secondary" size="sm" onClick={() => handleEventStatus(ev.id, 'termine')}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t('cal.completeBtn')}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold font-display">{t('cal.tasksTitle', { count: tasks.length })}</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-[#7A8290]">{t('cal.noTasks')}</p>
            ) : (
              <div className="divide-y divide-[#E7EAF0] dark:divide-gray-800 text-sm">
                {tasks.map((tk) => (
                  <div key={tk.id} className="py-3 flex items-start justify-between gap-2">
                    <div>
                      <div className={`font-medium text-xs ${tk.status === 'done' ? 'line-through text-[#7A8290]' : ''}`}>
                        {tk.title}
                      </div>
                      <div className="text-[11px] text-[#7A8290] mt-0.5">
                        {tk.marque ? `${tk.marque} ${tk.modele} · ` : ''}
                        {tk.due_date ? `${t('cal.duePrefix')} ${date(tk.due_date)}` : t('cal.noDueDate')} ·{' '}
                        {t('cal.priorityPrefix')} {prioLabel(tk.priority)}
                      </div>
                    </div>
                    <Select
                      value={tk.status}
                      onChange={(e) => handleTaskStatus(tk.id, e.target.value as 'todo' | 'in_progress' | 'done')}
                      className="w-28 text-xs min-h-[32px] py-1"
                    >
                      <option value="todo">{t('cal.taskTodo')}</option>
                      <option value="in_progress">{t('cal.taskInProgress')}</option>
                      <option value="done">{t('cal.taskDone')}</option>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal open={eventModalOpen} onClose={() => setEventModalOpen(false)} title={t('cal.eventModalTitle')}>
        <form onSubmit={handleCreateEvent} className="space-y-4">
          <div>
            <FieldLabel required>{t('cal.eventTitle')}</FieldLabel>
            <Input
              required
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              placeholder={t('cal.eventTitlePlaceholder')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('cal.eventType')}</FieldLabel>
              <Select value={evType} onChange={(e) => setEvType(e.target.value as typeof evType)}>
                <option value="rdv_client">{t('evType.rdv_client')}</option>
                <option value="achat">{t('evType.achat')}</option>
                <option value="vente">{t('evType.vente')}</option>
                <option value="controle_technique">{t('evType.controle_technique')}</option>
                <option value="reparation">{t('evType.reparation')}</option>
                <option value="inspection">{t('evType.inspection')}</option>
                <option value="rappel">{t('evType.rappel')}</option>
              </Select>
            </div>
            <div>
              <FieldLabel required>{t('cal.dateTime')}</FieldLabel>
              <Input type="datetime-local" required value={evStart} onChange={(e) => setEvStart(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>{t('doc.linkedVehicle')}</FieldLabel>
              <Select value={evVehicleId} onChange={(e) => setEvVehicleId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {(vehData?.vehicles || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.marque} {v.modele}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>{t('cal.location')}</FieldLabel>
              <Input
                value={evLocation}
                onChange={(e) => setEvLocation(e.target.value)}
                placeholder={t('cal.locationPlaceholder')}
              />
            </div>
          </div>
          <div>
            <FieldLabel>{t('mkt.description')}</FieldLabel>
            <Textarea rows={2} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setEventModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('cal.saveEventBtn')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} title={t('cal.taskModalTitle')} maxWidth="max-w-md">
        <form onSubmit={handleCreateTask} className="space-y-4">
          <div>
            <FieldLabel required>{t('cal.taskTitleLabel')}</FieldLabel>
            <Input required value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>{t('cal.dueDate')}</FieldLabel>
              <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
            </div>
            <div>
              <FieldLabel>{t('cal.priority')}</FieldLabel>
              <Select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as typeof taskPriority)}>
                <option value="low">{t('cal.prioLow')}</option>
                <option value="medium">{t('cal.prioMedium')}</option>
                <option value="high">{t('cal.prioHigh')}</option>
              </Select>
            </div>
          </div>
          <div>
            <FieldLabel>{t('common.vehicle')}</FieldLabel>
            <Select value={taskVehicleId} onChange={(e) => setTaskVehicleId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {(vehData?.vehicles || []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.marque} {v.modele}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setTaskModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('cal.createTaskBtn')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
