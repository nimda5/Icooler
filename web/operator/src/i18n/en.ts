// Тексты интерфейса — английские наши (P-01d); переводы LV, RU, ET, LT — от SIG/VENDEN, тем же набором ключей.
export const en = {
  app: { title: 'iCooler', subtitle: 'Operator portal' },
  nav: {
    dashboard: 'Dashboard', devices: 'Devices', map: 'Map', clients: 'Clients', alerts: 'Alerts', reports: 'Reports',
    esim: 'eSIM', users: 'Users', endUsers: 'End users', audit: 'Audit log', settings: 'Settings', profile: 'Profile',
    tenants: 'Tenants', logout: 'Log out',
  },
  common: {
    save: 'Save', cancel: 'Cancel', confirm: 'Confirm', delete: 'Delete', block: 'Block', unblock: 'Unblock', edit: 'Edit',
    loadMore: 'Load more', search: 'Search', all: 'All', name: 'Name', email: 'E-mail', language: 'Language', role: 'Role',
    status: 'Status', created: 'Created', lastLogin: 'Last login', never: 'never', actions: 'Actions', loading: 'Loading…', retry: 'Retry',
    error: 'Something went wrong', saved: 'Saved', notFound: 'Page not found', back: 'Back', soon: 'This section is coming in a later release.',
  },
  roles: { admin: 'Administrator', tech: 'Technical specialist', exec: 'Executive / manager', dispatcher: 'Support operator / dispatcher', end_user: 'End user', sig_admin: 'SIG administrator' },
  statuses: { invited: 'Invited', active: 'Active', blocked: 'Blocked' },
  languages: { lv: 'Latviešu', ru: 'Русский', en: 'English', et: 'Eesti', lt: 'Lietuvių' },
  login: {
    title: 'Sign in', password: 'Password', submit: 'Sign in', forgot: 'Forgot password?', wrong: 'Wrong e-mail or password',
    locked: 'Sign-in is temporarily locked after several failed attempts. Try again in 15 minutes.',
    tooMany: 'Too many attempts. Try again later.',
  },
  forgot: { title: 'Reset password', submit: 'Send link', sent: 'If an account exists for this e-mail, we have sent a link to it.', back: 'Back to sign in' },
  reset: { title: 'New password', submit: 'Set password', done: 'Password changed. Sign in with the new password.', invalid: 'The link is invalid or has expired.' },
  invite: { title: 'Accept invitation', submit: 'Set password and sign in', invalid: 'The invitation is invalid or has expired.' },
  password: { new: 'New password', repeat: 'Repeat password', current: 'Current password', min: 'At least 12 characters', mismatch: 'Passwords do not match', change: 'Change password', changed: 'Password changed. Other sessions were signed out.' },
  profile: { title: 'Profile', logoutAll: 'Sign out everywhere' },
  users: {
    title: 'Users', invite: 'Invite user', invited: 'Invitation sent', confirmBlock: 'Block this user? Their sessions end immediately.',
    confirmDelete: 'Delete this user? This cannot be undone from the portal.', self: 'You', filterRole: 'Role', filterStatus: 'Status',
  },
  endUsers: {
    title: 'End users', invite: 'Invite end user', client: 'Client', clients: 'Clients', bind: 'Add client', unbind: 'Remove',
    noClients: 'Clients will be available when the clients section is released.', confirmUnbind: 'Remove access to this client? The end user is signed out.',
  },
  audit: { title: 'Audit log', action: 'Action', object: 'Object', user: 'User', from: 'From', to: 'To', at: 'Time', ip: 'IP', details: 'Changes', empty: 'No entries' },
  settings: {
    title: 'Platform settings', inherited: 'Inherited', levels: { platform: 'Platform default', tenant: 'Tenant', device: 'Device' },
    reset: 'Reset to inherited', required: 'Enter a value or reset to inherited', sections: { offline: 'Offline', hot: 'Hot water', cold: 'Cold water', filter: 'Filter' },
    keys: {
      offline_after_min: 'Device offline after no heartbeat, min', offline_alert_after_min: '“Offline” alert after, min',
      hot_alert_below_set_c: 'Alert if below set point by more than, °C', hot_alert_above_c: 'Alert above, °C', hot_alert_after_min: 'For longer than, min',
      cold_alert_above_set_c: 'Alert if above set point by more than, °C', cold_alert_below_c: 'Alert below, °C', cold_alert_after_min: 'For longer than, min',
      filter_warning_pct: 'Warning at or below, %', filter_critical_pct: 'Critical at or below, %', upcoming_filters_days: 'Upcoming replacements list, days',
      filter_forecast_window_days: 'Forecast: average daily use over, days',
    },
  },
} as const;

export type Dict = typeof en;
