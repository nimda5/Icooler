// Карта устройств (V-025…V-027): цвет — online/offline/алерт/предупреждение; кластеры считает сервер по рамке и
// масштабу; несколько кулеров на одном адресе — один значок с числом, по нажатию — список с этажом и местом (P-05).
// Подложка — тайлы VITE_MAP_TILES (по умолчанию OpenStreetMap; в облаке — Azure Maps с ключом с infra/core).
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import L from 'leaflet';
import { Anchor, Badge, Box, Button, Card, CloseButton, Group, NumberInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconAdjustments, IconSearch } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { api, ok, type Schemas } from '../api/client';
import { t } from '../i18n';
import { LoadError, PageTitle } from './common';
import { ALERT_OPTS, STATE_DOT, STATE_OPTS } from './devices';
import { useClientOptions } from './end-users';

type MapView = Schemas['MapView'];
type Pin = MapView['devices'][number];
const COLOR: Record<string, string> = { green: '#2f9e44', grey: '#868e96', red: '#e03131', yellow: '#f08c00' };
const TILES = import.meta.env['VITE_MAP_TILES'] as string | undefined ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env['VITE_MAP_ATTRIBUTION'] as string | undefined ?? '© OpenStreetMap contributors';
const START: [number, number] = [56.95, 24.1]; // Рига
const LATVIA: L.LatLngBoundsExpression = [[55.65, 20.95], [58.1, 28.25]];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface View { bbox: string; zoom: number }

/** Рамка карты в формате контракта: min_lng,min_lat,max_lng,max_lat — в пределах допустимых координат. */
export function bboxOf(b: L.LatLngBounds): string {
  return [clamp(b.getWest(), -180, 180), clamp(b.getSouth(), -90, 90), clamp(b.getEast(), -180, 180), clamp(b.getNorth(), -90, 90)]
    .map((v) => v.toFixed(5)).join(',');
}

/** Устройства одной точки (одного адреса) — вместе: на карте их различает список, а не наложенные значки. */
export function groupByPoint(pins: Pin[]): Pin[][] {
  const m = new Map<string, Pin[]>();
  for (const p of pins) {
    const k = `${p.lat},${p.lng}`;
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return [...m.values()];
}

const worst = (pins: Pin[]) => ['red', 'yellow', 'green', 'grey'].find((c) => pins.some((p) => p.color === c)) ?? 'grey';

function dot(color: string, text = '') {
  return L.divIcon({
    className: '', iconSize: [22, 22], iconAnchor: [11, 11],
    html: `<span aria-hidden="true" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${COLOR[color]};border:2px solid #fff;box-shadow:0 0 2px #0008;color:#fff;font:600 11px sans-serif;cursor:pointer">${text}</span>`,
  });
}

function bubble(count: number, byColor: Record<string, number>) {
  const color = ['red', 'yellow', 'green', 'grey'].find((c) => byColor[c]) ?? 'grey';
  const size = count < 10 ? 30 : count < 100 ? 36 : 44;
  return L.divIcon({
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: `<span aria-hidden="true" style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${COLOR[color]}cc;border:3px solid #fff;box-shadow:0 0 3px #0008;color:#fff;font:700 12px sans-serif;cursor:pointer">${count}</span>`,
  });
}

export function MapPage() {
  const location = useLocation();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [selected, setSelected] = useState<Pin[] | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [region, setRegion] = useState('');
  const [alertType, setAlertType] = useState<string | null>(null);
  const [filterMax, setFilterMax] = useState<number | ''>('');
  const clients = useClientOptions();
  // Телефон: панель фильтров свёрнута, чтобы не закрывать карту; открывается кнопкой.
  const narrow = useMediaQuery('(max-width: 640px)') ?? false;
  const [panel, setPanel] = useState<boolean | null>(null);
  const panelOpen = panel ?? !narrow;

  useEffect(() => {
    if (!el.current) return;
    const p = new URLSearchParams(location.search);
    const rawLat = p.get('lat')?.trim() ?? '', rawLng = p.get('lng')?.trim() ?? '';
    const lat = Number(rawLat), lng = Number(rawLng);
    const at = rawLat !== '' && rawLng !== '' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    // Кнопки масштаба — внизу справа (сверху слева — панель фильтров); без точки — вся Латвия правее панели.
    const m = L.map(el.current, { center: at ? [lat, lng] : START, zoom: at ? 17 : 7, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    if (!at && m.getSize().x > 400) m.fitBounds(LATVIA, { paddingTopLeft: [300, 10], paddingBottomRight: [10, 10] }); // узкий экран — просто Рига
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    const update = () => setView({ bbox: bboxOf(m.getBounds()), zoom: Math.round(m.getZoom()) });
    m.on('moveend', update);
    update();
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  const filters = {
    ...(state ? { state } : {}), ...(clientId ? { client_id: clientId } : {}), ...(region.trim() ? { region: region.trim() } : {}),
    ...(alertType ? { alert_type: alertType } : {}), ...(filterMax !== '' ? { filter_left_max_pct: filterMax } : {}),
  };
  const filterKey = JSON.stringify(filters);
  // Другие фильтры — прежний выбор на карте больше не про них.
  useEffect(() => { setSelected(null); }, [filterKey]);
  const data = useQuery({
    queryKey: ['map', view, filters], enabled: !!view, placeholderData: (prev) => prev,
    queryFn: () => ok(api.GET('/map', { params: { query: { bbox: view!.bbox, zoom: view!.zoom, ...filters } as never } })),
  });

  const inView = data.data ? data.data.clusters.reduce((n, c) => n + c.count, 0) + data.data.devices.length : null;

  useEffect(() => {
    const g = layer.current;
    if (!g || !data.data) return;
    g.clearLayers();
    // Открытая панель — по свежему ответу: пропавшие из него устройства убираются, остальные обновляются.
    const fresh = new Map(data.data.devices.map((p) => [p.id, p]));
    setSelected((sel) => {
      if (!sel) return sel;
      const next = sel.map((p) => fresh.get(p.id)).filter((p): p is Pin => !!p);
      return next.length ? next : null;
    });
    /** Имя значка — на фокусируемом элементе маркера (Leaflet ставит role=button и tabindex на него). */
    const named = (m: L.Marker, label: string) => { m.getElement()?.setAttribute('aria-label', label); return m; };
    for (const c of data.data.clusters) {
      named(L.marker([c.lat, c.lng], { icon: bubble(c.count, c.by_color), keyboard: true })
        .on('click', () => map.current?.setView([c.lat, c.lng], Math.min((map.current?.getZoom() ?? 0) + 2, 18)))
        .addTo(g), `${c.count} — ${t('map.zoomIn')}`);
    }
    for (const pins of groupByPoint(data.data.devices)) {
      const p = pins[0]!;
      const label = pins.length > 1 ? `${pins.length} — ${p.address ?? ''}` : [p.client_name, p.address, p.floor, p.place].filter(Boolean).join(', ');
      named(L.marker([p.lat, p.lng], { icon: dot(worst(pins), pins.length > 1 ? String(pins.length) : ''), keyboard: true })
        .on('click', () => setSelected(pins))
        .addTo(g), label);
    }
  }, [data.data]);

  return (
    <Stack gap={0}>
      <PageTitle sub={inView == null ? ' ' : `${inView} ${t('map.inView')}`}>{t('map.title')}</PageTitle>
      {data.isError && <LoadError error={data.error} retry={() => data.refetch()} />}
      {/* Свой контекст наложения: z-index слоёв Leaflet и панели (1000) не поднимается над выпадающими списками и меню */}
      <Box pos="relative" style={{ isolation: 'isolate', zIndex: 0 }}>
        <div ref={el} data-testid="map" className="ic-card" style={{ height: 'calc(100vh - 170px)', minHeight: 420, overflow: 'hidden' }} />
        {!panelOpen && (
          <Button variant="default" leftSection={<IconAdjustments size={16} />} onClick={() => setPanel(true)} pos="absolute" top={14} left={14} style={{ zIndex: 1000 }}>
            {t('map.filters')}
          </Button>
        )}
        {panelOpen && <div className="ic-glass" style={{ position: 'absolute', top: 14, left: 14, zIndex: 1000, width: 'min(290px, calc(100% - 28px))', padding: 12, maxHeight: 'calc(100% - 28px)', overflow: 'auto' }}>
          <Stack gap="xs">
            {narrow && <Group justify="space-between"><Text fw={600} size="sm">{t('map.filters')}</Text><CloseButton aria-label={t('map.hideFilters')} onClick={() => setPanel(false)} /></Group>}
            <Select placeholder={t('map.findClient')} aria-label={t('devices.client')} data={clients.data ?? []} value={clientId} onChange={setClientId} searchable clearable
              leftSection={<IconSearch size={15} />} />
            <div className="ic-statelist" role="group" aria-label={t('devices.state')}>
              {[{ v: null as string | null, label: t('map.allDevices'), dot: 'var(--text-3)' }, ...STATE_OPTS.map((o) => ({ v: o.value as string | null, label: o.label, dot: STATE_DOT[o.value]! }))].map((o) => (
                <button key={o.label} type="button" aria-pressed={state === o.v} onClick={() => setState(o.v)}>
                  <span className="dot" style={{ background: o.dot }} />{o.label}{o.v === null && inView != null && <span className="n">{inView}</span>}
                </button>
              ))}
            </div>
            <TextInput placeholder={t('devices.allRegions')} aria-label={t('clients.region')} value={region} onChange={(e) => setRegion(e.currentTarget.value)} />
            <Select placeholder={t('devices.allAlerts')} aria-label={t('devices.alertType')} data={ALERT_OPTS} value={alertType} onChange={setAlertType} clearable />
            <NumberInput placeholder={t('devices.filterMax')} aria-label={t('devices.filterMax')} min={0} max={100} value={filterMax}
              onChange={(v) => setFilterMax(v === '' ? '' : Number(v))} />
            <Group gap={10} px={4} className="ic-secondary">
              {(['green', 'grey', 'yellow', 'red'] as const).map((c) => (
                <Group key={c} gap={5}><span style={{ width: 8, height: 8, borderRadius: 8, background: COLOR[c] }} />{t(`map.legend.${c}`)}</Group>
              ))}
            </Group>
          </Stack>
        </div>}
        {selected && (
          <Card className="ic-glass" pos="absolute" top={14} right={14} w={320} style={{ zIndex: 1000, maxHeight: 'calc(100% - 28px)', overflow: 'auto' }}>
            <Group justify="space-between" mb="xs" wrap="nowrap">
              <Title order={5}>{selected.length > 1 ? t('map.atAddress') : selected[0]!.client_name ?? '—'}</Title>
              <CloseButton aria-label={t('common.cancel')} onClick={() => setSelected(null)} />
            </Group>
            <Stack gap="sm">
              {selected.map((p) => (
                <div key={p.id}>
                  {selected.length > 1 && <Text size="sm" fw={500}>{p.client_name ?? '—'}</Text>}
                  <Text size="sm">{p.address ?? '—'}</Text>
                  <Text size="xs" c="dimmed">{[p.floor && `${t('clients.floor')} ${p.floor}`, p.place].filter(Boolean).join(' · ')}</Text>
                  <Group gap="xs" mt={2}>
                    <Badge variant="dot" color={COLOR[p.color]}>{t(`map.legend.${p.color}`)}</Badge>
                    <Badge variant="light" color="gray">{t('devices.filter')}: {p.filter_left_pct == null ? '—' : `${Math.round(p.filter_left_pct)} %`}</Badge>
                    {p.alerts_open ? <Badge color="red" variant="light">{p.alerts_open} {t('devices.alerts')}</Badge> : null}
                    <Anchor component={Link} to={`/devices/${p.id}`} size="sm">{t('map.open')}</Anchor>
                  </Group>
                </div>
              ))}
            </Stack>
          </Card>
        )}
      </Box>
      <Text size="xs" c="dimmed" mt="xs">{t('map.noCoords')}</Text>
    </Stack>
  );
}
