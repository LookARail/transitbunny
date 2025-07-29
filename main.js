// Updated JavaScript: GTFS Animation with Accurate Interpolation Based on Stop Times

// === Global GTFS data ===
let stops = [];
let shapes = [];
let routes = [];
let trips = [];
let stopTimes = [];

let animationTimer = null;
let simulationTime = null;
let animationStartTime = null;
let currentTrip = null;
let remainingTrips = [];

// === Layers for filtering geometry ===
let stopsLayer = null;
let shapesLayer = null;

// === Filter & Animation State ===
let routeTypes = [];
let serviceIds = [];
let filteredTrips = [];
let tripPaths = [];
let vehicleMarkers = null;

// === Precomputed maps ===
let tripStartTimeMap = {};   // 
let tripStopsMap     = {};   // 

// === Short‑name lookup by route_type ===
const shortAndLongNamesByType = {}; // 

// === Animation Controls ===
const FRAME_INTERVAL_MS = 100;   // real ms per frame
const TIME_STEP_SEC    = 10;    // simulated seconds per frame

// === Initialize Leaflet Map ===
const map = L.map('map').setView([0, 0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

async function loadGtfsFromWebZip() {


  const url = 'gtfs.zip';

  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const zip = fflate.unzipSync(new Uint8Array(buffer));

    const decoder = new TextDecoder();
    const stopsText = decoder.decode(zip['stops.txt']);
    const routesText = decoder.decode(zip['routes.txt']);
    const tripsText = decoder.decode(zip['trips.txt']);
    const shapesText = decoder.decode(zip['shapes.txt']);
    const stopTimesText = decoder.decode(zip['stop_times.txt']);

    stops = parseStops(stopsText);
    shapes = parseShapes(shapesText);
    routes = parseRoutes(routesText);
    trips = parseTrips(tripsText);
    stopTimes = parseStopTimes(stopTimesText);
    
    // Precompute trip start times (stop_sequence === 1)
    tripStartTimeMap = {};
    tripStopsMap     = {};
    stopTimes.forEach(st => {
      // start time
      if (st.stop_sequence === 1) {
        // Only set first departure or arrival
        const t = tripStartTimeMap[st.trip_id];
        const timeSec = timeToSeconds(st.departure_time || st.arrival_time);
        if (t === undefined || timeSec < t) tripStartTimeMap[st.trip_id] = timeSec;
      }
      // stops map
      if (!tripStopsMap[st.trip_id]) tripStopsMap[st.trip_id] = new Set();
      tripStopsMap[st.trip_id].add(st.stop_id);
    });

    initializeTripsRoutes(trips, routes);
    plotStopsAndShapes();

  } catch (err) {
    console.error('Failed to load GTFS ZIP:', err);
  }
}


// === Load GTFS data ===
function loadLocalGtfsData() {
  Promise.all([
    fetch('gtfs/stops.txt').then(res => res.text()),
    fetch('gtfs/shapes.txt').then(res => res.text()),
    fetch('gtfs/routes.txt').then(res => res.text()),
    fetch('gtfs/trips.txt').then(res => res.text()),
    fetch('gtfs/stop_times.txt').then(res => res.text())
  ]).then(([stopsText, shapesText, routesText, tripsText, stopTimesText]) => {
    stops = parseStops(stopsText);
    shapes = parseShapes(shapesText);
    routes = parseRoutes(routesText);
    trips = parseTrips(tripsText);
    stopTimes = parseStopTimes(stopTimesText);
    
    // Precompute trip start times (stop_sequence === 1)
    tripStartTimeMap = {};
    tripStopsMap     = {};
    stopTimes.forEach(st => {
      // start time
      if (st.stop_sequence === 1) {
        // Only set first departure or arrival
        const t = tripStartTimeMap[st.trip_id];
        const timeSec = timeToSeconds(st.departure_time || st.arrival_time);
        if (t === undefined || timeSec < t) tripStartTimeMap[st.trip_id] = timeSec;
      }
      // stops map
      if (!tripStopsMap[st.trip_id]) tripStopsMap[st.trip_id] = new Set();
      tripStopsMap[st.trip_id].add(st.stop_id);
    });

    initializeTripsRoutes(trips, routes);
    plotStopsAndShapes();
  }).catch(error => console.error('GTFS Load Error:', error));
}


function parseStops(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const idIndex = headers.indexOf('stop_id');
  const nameIndex = headers.indexOf('stop_name');
  const latIndex = headers.indexOf('stop_lat');
  const lonIndex = headers.indexOf('stop_lon');

  if (latIndex === -1 || lonIndex === -1) {
    throw new Error('Missing stop_lat or stop_lon columns in stops.txt');
  }

  return lines.slice(1).map(row => {
    const cols = row.split(',');
    return {
      id: cols[idIndex],
      name: cols[nameIndex],
      lat: parseFloat(cols[latIndex]),
      lon: parseFloat(cols[lonIndex])
    };
  });
}


function parseShapes(text) {
  const rows = text.trim().split('\n').slice(1);
  return rows.map(row => {
    const [shape_id, lat, lon, sequence] = row.split(',');
    return {
      shape_id,
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      sequence: parseInt(sequence)
    };
  });
}

function parseRoutes(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const routeIdIndex = headers.indexOf('route_id');
  const shortNameIndex = headers.indexOf('route_short_name');
  const longNameIndex = headers.indexOf('route_long_name');
  const typeIndex = headers.indexOf('route_type');

  if (routeIdIndex === -1 || typeIndex === -1) {
    throw new Error('Missing required columns in routes.txt');
  }

  return lines.slice(1).map(row => {
    const cols = row.split(',');
    return {
      route_id: cols[routeIdIndex],
      route_short_name: cols[shortNameIndex] || '',
      route_long_name: cols[longNameIndex] || '',
      route_type: cols[typeIndex]
    };
  });
}


function parseTrips(text) {
  const rows = text.trim().split('\n').slice(1);
  return rows.map(row => {
    const [route_id, service_id, trip_id, headsign, trip_short_name, direction_id, block_id, shape_id] = row.split(',');
    return { route_id, service_id, trip_id, shape_id };
  });
}

function parseStopTimes(text) {
  const rows = text.trim().split('\n').slice(1);
  return rows.map(row => {
    const [trip_id, arrival_time, departure_time, stop_id, stop_sequence] = row.split(',');
    return {
      trip_id,
      stop_id,
      arrival_time,
      departure_time,
      stop_sequence: parseInt(stop_sequence)
    };
  });
}

// === Data Relationships & Filters ===
function initializeTripsRoutes(tripsArr, routesArr) {
  const routeMap = new Map(routesArr.map(r=>[r.route_id,r]));
  routeTypes = [...new Set(routesArr.map(r => r.route_type))];
  serviceIds = [...new Set(tripsArr.map(t => t.service_id))];
  
  // Build shortNamesByType per route_type
  routesArr.forEach(r => {
    if (!shortAndLongNamesByType[r.route_type]) shortAndLongNamesByType[r.route_type] = new Set();
    shortAndLongNamesByType[r.route_type].add(`${r.route_short_name}-${r.route_long_name}`);
  });
    // convert to arrays
  Object.keys(shortAndLongNamesByType).forEach(rt => {
    shortAndLongNamesByType[rt] = [...shortAndLongNamesByType[rt]].sort();
  });

  tripsArr.forEach(t=>t.route=routeMap.get(t.route_id));
  populateFilters();
}

function populateFilters() {
  const rtSel = document.getElementById('routeTypeSelect');
  const shSel = document.getElementById('routeShortNameSelect'); 
  const svSel = document.getElementById('serviceIdSelect');
  rtSel.innerHTML = routeTypes.map(v=>`<option value="${v}">${v}</option>`).join('');
  svSel.innerHTML = serviceIds.map(v=>`<option value="${v}">${v}</option>`).join('');
  rtSel.onchange = filterTrips;
  svSel.onchange = filterTrips;

  // When route‐type changes, update short‐names dropdown
  rtSel.onchange = () => {
    const chosen = Array.from(rtSel.selectedOptions).map(o => o.value);
    let names = new Set();

    chosen.forEach(rt => {
      (shortAndLongNamesByType[rt] || []).forEach(n => {names.add(n);});
    });
    
    shSel.innerHTML = [...names].sort().map(n => `<option value="${n}">${n}</option>`).join('');
    filterTrips();
  };

  // Hook up short‐name & service onchange
  shSel.onchange = filterTrips;
  svSel.onchange = filterTrips;

  // trigger initial population of short names
  rtSel.dispatchEvent(new Event('change'));
}


function filterTrips() {
  const types = Array.from(document.getElementById('routeTypeSelect').selectedOptions).map(o => o.value);
  const names = Array.from(document.getElementById('routeShortNameSelect').selectedOptions).map(o => o.value);
  const services = Array.from(document.getElementById('serviceIdSelect').selectedOptions).map(o => o.value);

  filteredTrips = trips.filter(t =>
    types.includes(t.route.route_type) &&
    names.includes(`${t.route.route_short_name}-${t.route.route_long_name}`) && 
    services.includes(t.service_id)
  );
}

// === Filter geometry by filteredTrips ===
function filterStopsAndShapesForTrips(tripsToShow) {
  if (stopsLayer)  map.removeLayer(stopsLayer);
  if (shapesLayer) map.removeLayer(shapesLayer);

  stopsLayer  = L.layerGroup();
  shapesLayer = L.layerGroup();

  const usedStops  = new Set();
  const usedShapes = new Set();
  tripsToShow.forEach(t => {
    usedShapes.add(t.shape_id);
    (tripStopsMap[t.trip_id] || []).forEach(id => usedStops.add(id));
  });

  stops.filter(s => usedStops.has(s.id))
       .forEach(s => L.circleMarker([s.lat,s.lon],{radius:4,color:'red'}).bindTooltip(s.name).addTo(stopsLayer));

  const grp = {};
  shapes.filter(p => usedShapes.has(p.shape_id))
        .forEach(p => (grp[p.shape_id]||(grp[p.shape_id]=[])).push(p));
  Object.values(grp).forEach(arr => {
    const pts = arr.sort((a,b)=>a.sequence-b.sequence).map(p=>[p.lat,p.lon]);
    L.polyline(pts,{color:'blue',weight:2}).addTo(shapesLayer);
  });

  stopsLayer.addTo(map);
  shapesLayer.addTo(map);
}


// === Plot initial GTFS stops & shapes ===
function plotStopsAndShapes() {
  stopsLayer = L.layerGroup();
  shapesLayer = L.layerGroup();

  for (const stop of stops) {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: 4,
      color: 'red',
      fillColor: 'red',
      fillOpacity: 0.8
    }).bindTooltip(stop.name);
    stopsLayer.addLayer(marker);
  }

  const shapesById = {};
  for (const s of shapes) {
    if (!shapesById[s.shape_id]) shapesById[s.shape_id] = [];
    shapesById[s.shape_id].push(s);
  }

  for (const shape_id in shapesById) {
    const shapePoints = shapesById[shape_id]
      .sort((a, b) => a.sequence - b.sequence)
      .map(s => [s.lat, s.lon]);
    const polyline = L.polyline(shapePoints, {
      color: 'blue',
      weight: 2
    });
    shapesLayer.addLayer(polyline);
  }

  stopsLayer.addTo(map);
  shapesLayer.addTo(map);

  const allCoords = [...stops.map(s => [s.lat, s.lon]), ...shapes.map(s => [s.lat, s.lon])];
  const bounds = L.latLngBounds(allCoords);
  map.fitBounds(bounds);
}

// === Utility: Parse HH:MM:SS into seconds ===
function timeToSeconds(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// === Interpolate times between stops (distance-based) ===
function interpolateTripPath(trip) {
  const tripStops = stopTimes.filter(st=>st.trip_id===trip.trip_id).sort((a,b)=>a.stop_sequence-b.stop_sequence);
  const shapePts = shapes.filter(s=>s.shape_id===trip.shape_id).sort((a,b)=>a.sequence-b.sequence);
  const stopPositions = tripStops.map(st=>{
    const stop = stops.find(s=>s.id===st.stop_id);
    return { lat:stop.lat, lon:stop.lon, time: timeToSeconds(st.departure_time) };
  });

  const timedPath = [];
  let idxStop = 0;
  for(let i=0;i<shapePts.length;i++){
    const {lat,lon} = shapePts[i];
    if(idxStop>=stopPositions.length-1) break;
    const curr = stopPositions[idxStop], next=stopPositions[idxStop+1];
    const dTotal=calculateDistance(curr.lat,curr.lon,next.lat,next.lon);
    const dCur=calculateDistance(curr.lat,curr.lon,lat,lon);
    if(dCur>dTotal) { idxStop++; if(idxStop>=stopPositions.length-1) break; }
    const prog = dTotal>0? dCur/dTotal:0;
    const time = curr.time + (next.time-curr.time)*prog;
    timedPath.push({lat,lon,time});
  }
  return timedPath;
}

// === Animation Controls ===
function initializeAnimation() {
  if (!filteredTrips.length) { alert('No trips match filters'); return; }
// compute startTime for filtered trips and find earliest

  // filter geometry
  filterStopsAndShapesForTrips(filteredTrips);

  // prepare remaining
  remainingTrips = filteredTrips.map(t => {
    t.startTime = tripStartTimeMap[t.trip_id] ?? null;
    return t;
  }).filter(t => t.startTime != null);

  tripPaths = [];
  if (Array.isArray(vehicleMarkers)) {
    vehicleMarkers.forEach(m => { if (m) map.removeLayer(m); });
  }

  vehicleMarkers = [];
  simulationTime = Infinity;

  // determine earliest start time among remainingTrips
  simulationTime = remainingTrips.reduce((min, t) => Math.min(min, t.startTime), Infinity);

  if (simulationTime === Infinity) { alert('No valid stop times'); return; }
  animationStartTime = simulationTime;
  document.getElementById('timeDisplay').textContent = formatTime(simulationTime);
}

function startAnimation() {
  if (simulationTime == null) return;
  if (animationTimer) return;
  animationTimer = setInterval(() => {
      simulationTime += TIME_STEP_SEC;
      document.getElementById('timeDisplay').textContent = formatTime(simulationTime);

      UpdateVehiclePositions();
    }, FRAME_INTERVAL_MS);
}

function UpdateVehiclePositions(){
    // activate trips whose startTime <= now
    remainingTrips = remainingTrips.filter(t=>{
      if(t.startTime<=simulationTime) {
        const path = interpolateTripPath(t);
        if(path.length) {
          tripPaths.push(path);
          const m = L.circleMarker([path[0].lat,path[0].lon], { radius:6, color:'green', fillColor:'green', fillOpacity:1 }).addTo(map);
          vehicleMarkers.push(m);
        }
        return false;
      }
      return true;
    });

    // Update active vehicles and remove finished ones
    for (let i = tripPaths.length - 1; i >= 0; i--) {
      const path = tripPaths[i];
      const endTime = path[path.length - 1].time;
      if (simulationTime >= endTime) {
        // Trip finished: remove marker and path
        map.removeLayer(vehicleMarkers[i]);
        vehicleMarkers.splice(i, 1);
        tripPaths.splice(i, 1);
        continue;
      }
      const idx = timedIndex(simulationTime, path);
      if (idx >= 0 && idx < path.length - 1) {
        const a = path[idx], b = path[idx + 1];
        const frac = (simulationTime - a.time) / (b.time - a.time);
        const lat = a.lat + (b.lat - a.lat) * frac;
        const lon = a.lon + (b.lon - a.lon) * frac;
        vehicleMarkers[i].setLatLng([lat, lon]);
      }
    }
  

    // stop when no trips remain and all animated complete
    if (!remainingTrips.length && tripPaths.every(path => path[path.length-1].time <= simulationTime)) {
      stopAnimation();
    }
  }


function stopAnimation() {
  // 1) Clear the running interval
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
  }

  // 2) Remove all vehicle markers from the map
  vehicleMarkers.forEach(marker => {
    if (marker && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  // 3) Reset all trip/animation state
  tripPaths = [];
  remainingTrips = [];
  vehicleMarkers = [];

  // 4) Reset the clock
  simulationTime = null;
  document.getElementById('timeDisplay').textContent = '00:00:00';

  // 5) Reset pause button label
  const pauseButton = document.getElementById('pauseButton');
  if (pauseButton) pauseButton.textContent = 'Pause';
}


// === Helper: find segment index by time using binary search ===
function timedIndex(time, path) {
  let low = 0, high = path.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (path[mid].time < time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

//pause function
function togglePauseResume(){
  const pauseButton = document.getElementById('pauseButton');
  if (animationTimer) {
    clearInterval(animationTimer);
    animationTimer = null;
    console.log("Simulation paused.");
    pauseButton.textContent = 'Resume';
  }else{    
    pauseButton.textContent = 'Pause';
      animationTimer = setInterval(() => {
      simulationTime += TIME_STEP_SEC;
      document.getElementById('timeDisplay').textContent = formatTime(simulationTime);
      UpdateVehiclePositions();
    }, FRAME_INTERVAL_MS);
  }
}

// === Run on Load ===
window.addEventListener('DOMContentLoaded', () => {
  loadGtfsFromWebZip();

  document.getElementById('routeTypeSelect');
  document.getElementById('serviceIdSelect');
  document.getElementById('playBtn').addEventListener('click', () => {
    initializeAnimation();
    startAnimation();
  });

  document.getElementById('pauseButton').addEventListener('click', togglePauseResume);
  document.getElementById('stopBtn').addEventListener('click', stopAnimation);
});
