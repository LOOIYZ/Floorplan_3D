/**
 * Supabase Client & Realtime Sync for Campus Facility Reports
 */
import { createClient } from '@supabase/supabase-js';

// Read config from Vite env or localStorage overrides
const ENV_URL = import.meta.env.VITE_SUPABASE_URL || '';
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseUrl = ENV_URL || localStorage.getItem('fcsit_supabase_url') || '';
const supabaseAnonKey = ENV_KEY || localStorage.getItem('fcsit_supabase_key') || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'YOUR_SUPABASE_URL' &&
  supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY'
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    })
  : null;

/**
 * Map in-app report format to Supabase database table columns
 */
export function toDatabaseRow(r) {
  return {
    id: r.id,
    device_id: r.deviceId || '',
    room_code: r.roomCode || '',
    room_name: r.roomName || '',
    building_name: r.buildingName || '',
    level_name: r.levelName || '',
    category: r.category || '',
    facility_type: r.facilityType || '',
    facility_icon: r.facilityIcon || '',
    description: r.description || '',
    urgency: r.urgency || 'Medium',
    photo: r.photo || null,
    reporter_name: r.reporterName || '',
    reporter_contact: r.reporterContact || '',
    timestamp: r.timestamp || new Date().toISOString(),
    status: r.status || 'Pending Review',
  };
}

/**
 * Map Supabase database row to in-app report format
 */
export function fromDatabaseRow(row) {
  return {
    id: row.id,
    deviceId: row.device_id || '',
    roomCode: row.room_code || '',
    roomName: row.room_name || '',
    buildingName: row.building_name || '',
    levelName: row.level_name || '',
    category: row.category || '',
    facilityType: row.facility_type || '',
    facilityIcon: row.facility_icon || '',
    description: row.description || '',
    urgency: row.urgency || 'Medium',
    photo: row.photo || null,
    reporterName: row.reporter_name || '',
    reporterContact: row.reporter_contact || '',
    timestamp: row.timestamp || row.created_at || new Date().toISOString(),
    status: row.status || 'Pending Review',
  };
}

/**
 * Fetch all reports from Supabase ordered by timestamp
 */
export async function fetchReportsFromSupabase() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('facility_reports')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) {
      console.warn('[Supabase] Failed to fetch facility reports:', error.message);
      return null;
    }
    return data.map(fromDatabaseRow);
  } catch (err) {
    console.warn('[Supabase] Network/fetch error:', err);
    return null;
  }
}

/**
 * Insert or upsert a new report in Supabase
 */
export async function saveReportToSupabase(report) {
  if (!supabase) return false;
  try {
    const row = toDatabaseRow(report);
    const { error } = await supabase.from('facility_reports').upsert(row);
    if (error) {
      console.warn('[Supabase] Error saving report:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Insert error:', err);
    return false;
  }
}

/**
 * Update report status in Supabase
 */
export async function updateReportStatusInSupabase(id, status) {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('facility_reports')
      .update({ status })
      .eq('id', id);

    if (error) {
      console.warn('[Supabase] Error updating status:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Update error:', err);
    return false;
  }
}

/**
 * Delete a report in Supabase
 */
export async function deleteReportFromSupabase(id) {
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('facility_reports')
      .delete()
      .eq('id', id);

    if (error) {
      console.warn('[Supabase] Error deleting report:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] Delete error:', err);
    return false;
  }
}

/**
 * Subscribe to realtime Postgres changes for live multi-device syncing
 */
export function subscribeToRealtimeReports(onChange) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel('facility-reports-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'facility_reports' },
      (payload) => {
        if (typeof onChange === 'function') {
          onChange(payload);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
