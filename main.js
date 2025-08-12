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
let allVehicleMarkers = [];
let vehicleMarkersWithActiveTrip = null;

// === Precomputed maps ===
let tripStartTimeMap = {};   // 
let tripStopsMap     = {};   // 
let blockIdTripMap = {};

// === Short‑name lookup by route_type ===
let shortAndLongNamesByType = {}; // 
let shortNameToServiceIds = {}; 

// === Animation Controls ===
const FRAME_INTERVAL_MS = 100;   // real ms per frame
const TIME_STEP_SEC    = 1;    // simulated seconds per frame
let speedMultiplier = 10;

// === Initialize Leaflet Map ===
const map = L.map('map').setView([0, 0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let vehKmPendingPoints = {}; // { route_id: [{ x, y }], ... }

async function loadGtfsFromWebZip() {
  const url = 'gtfs.zip';
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const zip = fflate.unzipSync(new Uint8Array(buffer));
    LoadGTFSZipFile(zip);
  } catch (err) {
    console.error('Failed to load GTFS ZIP:', err);
  }
}


// Function to load GTFS from a user-uploaded zip file
async function loadGtfsFromUserUploadZip(file) {

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const buffer = e.target.result;
      const zip = fflate.unzipSync(new Uint8Array(buffer));

      LoadGTFSZipFile(zip);     
    } catch (err) {     
      alert('Failed to load GTFS ZIP: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);

}

async function LoadGTFSZipFile(zipFile) {
  try {
    showProgressBar();
    setProgressBar(10);
    await Promise.resolve();

    clearAllMapLayersAndMarkers();
    const decoder = new TextDecoder();

    const stopsText = decoder.decode(zipFile['stops.txt']);
    const routesText = decoder.decode(zipFile['routes.txt']);
    setProgressBar(30);
    await Promise.resolve();

    const tripsText = decoder.decode(zipFile['trips.txt']);
    const shapesText = decoder.decode(zipFile['shapes.txt']);
    setProgressBar(50);
    await Promise.resolve();

    const stopTimesText = decoder.decode(zipFile['stop_times.txt']);
    setProgressBar(70);
    await Promise.resolve();

    stops = parseStops(stopsText);
    setProgressBar(75);
    await Promise.resolve();

    shapes = parseShapes(shapesText);
    setProgressBar(80);
    await Promise.resolve();

    routes = parseRoutes(routesText);
    setProgressBar(85);
    await Promise.resolve();

    trips = parseTrips(tripsText);
    setProgressBar(90);
    await Promise.resolve();

    stopTimes = parseStopTimes(stopTimesText);
    setProgressBar(95);
    await Promise.resolve();

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
    setProgressBar(98);
    await Promise.resolve();

    initializeTripsRoutes(trips, routes);
    plotStopsAndShapes();
    setProgressBar(100);
    setTimeout(hideProgressBar, 500);
  } catch (err) {
    hideProgressBar();
    console.error('Failed to process GTFS ZIP:', err);
  }
}


function clearAllMapLayersAndMarkers() {
  // Remove stops layer if present
  if (stopsLayer && map.hasLayer(stopsLayer)) {
    map.removeLayer(stopsLayer);
    stopsLayer = null;
  }
  // Remove shapes layer if present
  if (shapesLayer && map.hasLayer(shapesLayer)) {
    map.removeLayer(shapesLayer);
    shapesLayer = null;
  }
  // Remove all vehicle markers
  if (Array.isArray(allVehicleMarkers)) {
    allVehicleMarkers.forEach(marker => {
      if (marker && map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    });
    allVehicleMarkers = [];
  }
  vehicleMarkersWithActiveTrip = [];

  // Also clear tripPaths and remainingTrips for safety
  tripPaths = [];
  remainingTrips = [];
    // Clear global GTFS data
  stops = [];
  shapes = [];
  routes = [];
  trips = [];
  stopTimes = [];
  // Clear filter & animation state
  routeTypes = [];
  serviceIds = [];
  filteredTrips = [];
  // Clear precomputed maps
  tripStartTimeMap = {};
  tripStopsMap = {};
  // Clear short-name lookup
  shortAndLongNamesByType = {};
  shortNameToServiceIds = {};
  // Clear animation state
  simulationTime = null;
  animationStartTime = null;
  currentTrip = null;
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
    const cols = row.split(',').map(col => col.trim()); 
    return {
      id: cols[idIndex],
      name: cols[nameIndex],
      lat: parseFloat(cols[latIndex]),
      lon: parseFloat(cols[lonIndex])
    };
  });
}


function parseShapes(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const shapeIDIndex = headers.indexOf('shape_id');
  const shapeLatIndex = headers.indexOf('shape_pt_lat');
  const shapeLonIndex = headers.indexOf('shape_pt_lon');
  const shapeSeqIndex = headers.indexOf('shape_pt_sequence');
  const shapeDistIndex = headers.indexOf('shape_dist_traveled');

  if (shapeIDIndex === -1 || shapeLatIndex === -1 || shapeLonIndex === -1 || shapeSeqIndex === -1) {
    throw new Error('Missing required columns in shapes.txt');
  }

  if (shapeDistIndex === -1) {
    console.log('No shape_dist_traveled columns provided in shapes.txt');
  }

  return lines.slice(1).map(row => {
    const cols = row.split(',').map(col => col.trim());
    return {
      shape_id: cols[shapeIDIndex],
      lat: parseFloat(cols[shapeLatIndex]),
      lon: parseFloat(cols[shapeLonIndex]),
      sequence: parseInt(cols[shapeSeqIndex]),
      shape_dist_traveled: shapeDistIndex !== -1 ? parseFloat(cols[shapeDistIndex]) : undefined
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
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const routeIdIndex = headers.indexOf('route_id');
  const serviceIdIndex = headers.indexOf('service_id');
  const tripIdIndex = headers.indexOf('trip_id');
  const shapeIdIndex = headers.indexOf('shape_id');
  const blockIDIndex = headers.indexOf('block_id');

  if (routeIdIndex === -1 || serviceIdIndex === -1 || tripIdIndex === -1 || blockIDIndex === -1) {
    throw new Error('Missing required columns in trips.txt');
  }

  return lines.slice(1).map(row => {
    const cols = row.split(',').map(col => col.trim());
    return {
      route_id: cols[routeIdIndex],
      service_id: cols[serviceIdIndex],
      trip_id: cols[tripIdIndex],
      shape_id: shapeIdIndex !== -1 ? cols[shapeIdIndex] : undefined,
      block_id: blockIDIndex !== -1 ? cols[blockIDIndex] : undefined
    };
  });
}

function parseStopTimes(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const tripIdIndex = headers.indexOf('trip_id');
  const arrivalTimeIndex = headers.indexOf('arrival_time');
  const departureTimeIndex = headers.indexOf('departure_time');
  const stopIdIndex = headers.indexOf('stop_id');
  const stopSequenceIndex = headers.indexOf('stop_sequence');

  if (
    tripIdIndex === -1 ||
    arrivalTimeIndex === -1 ||
    departureTimeIndex === -1 ||
    stopIdIndex === -1 ||
    stopSequenceIndex === -1
  ) {
    throw new Error('Missing required columns in stop_times.txt');
  }

  return lines.slice(1).map(row => {
    const cols = row.split(',').map(col => col.trim());
    return {
      trip_id: cols[tripIdIndex],
      arrival_time: cols[arrivalTimeIndex],
      departure_time: cols[departureTimeIndex],
      stop_id: cols[stopIdIndex],
      stop_sequence: parseInt(cols[stopSequenceIndex])
    };
  });
}

// === Data Relationships & Filters ===
function initializeTripsRoutes(tripsArr, routesArr) {
  shortAndLongNamesByType = {};

  const routeMap = new Map(routesArr.map(r=>[r.route_id,r]));
  routeTypes = [...new Set(routesArr.map(r => r.route_type))];
  serviceIds = [...new Set(tripsArr.map(t => t.service_id))];
  
   // Assign route object to each trip first!
  tripsArr.forEach(t => t.route = routeMap.get(t.route_id));

  // Build shortNamesByType per route_type
  routesArr.forEach(r => {
    if (!shortAndLongNamesByType[r.route_type]) shortAndLongNamesByType[r.route_type] = new Set();
    shortAndLongNamesByType[r.route_type].add(`${r.route_short_name}-${r.route_long_name}`);
  });

  shortNameToServiceIds = {}; // Reset mapping
  tripsArr.forEach(t => {
    const key = `${t.route.route_short_name}-${t.route.route_long_name}`;
    if (!shortNameToServiceIds[key]) shortNameToServiceIds[key] = new Set();
    shortNameToServiceIds[key].add(t.service_id);
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
    shSel.dispatchEvent(new Event('change')); // trigger short name change
  };

  // When short-name changes, update service IDs dropdown
  shSel.onchange = () => {
    const chosenNames = Array.from(shSel.selectedOptions).map(o => o.value);
    let validServiceIds = new Set();
    chosenNames.forEach(name => {
      (shortNameToServiceIds[name] || []).forEach(sid => validServiceIds.add(sid));
    });
    svSel.innerHTML = [...validServiceIds].sort().map(sid => `<option value="${sid}">${sid}</option>`).join('');
    filterTrips();
  };

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

console.log(`filtered trip count: ${tripsToShow.length}`);

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
  // Clear the trip plot data
  tripPlotData.labels = [];
  tripPlotData.datasets[0].data = [];
  if (tripPlotChart) tripPlotChart.update();
  hourTicks = [];

  //clear the vehicle km chart data
  vehKmData = {};
  if (vehKmChart) {
    vehKmChart.data.datasets = [];
    vehKmChart.options.scales.x.min = undefined;
    vehKmChart.update();
  }

  if (!filteredTrips.length) { alert('No trips match filters'); return; }
// compute startTime for filtered trips and find earliest

  // filter geometry
  filterStopsAndShapesForTrips(filteredTrips);

  // prepare remaining
  remainingTrips = filteredTrips.map(t => {
    t.startTime = tripStartTimeMap[t.trip_id] ?? null;
    return t;
  }).filter(t => t.startTime != null);

  blockIdTripMap = {};
  remainingTrips.forEach(t => {
    if (!blockIdTripMap[t.block_id]) blockIdTripMap[t.block_id] = [];
    blockIdTripMap[t.block_id].push(t);
  });
  // Sort each block's trips by startTime
  Object.values(blockIdTripMap).forEach(arr => arr.sort((a, b) => a.startTime - b.startTime));
  Object.values(blockIdTripMap).forEach(tripArr => {for (let i = 0; i < tripArr.length - 1; i++) {tripArr[i].nextTrip = tripArr[i + 1];}
  });

  tripPaths = [];
  if (Array.isArray(vehicleMarkersWithActiveTrip)) {
    vehicleMarkersWithActiveTrip.forEach(m => { if (m) map.removeLayer(m); });
  }

  vehicleMarkersWithActiveTrip = [];
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
      simulationTime += TIME_STEP_SEC * speedMultiplier;
      updateTripPlot(simulationTime, allVehicleMarkers.length);
      document.getElementById('timeDisplay').textContent = formatTime(simulationTime);
      UpdateVehiclePositions();
      flushVehKmPendingPoints();
    }, FRAME_INTERVAL_MS);
}

function UpdateVehiclePositions(){
    // activate trips whose startTime <= now
    remainingTrips = remainingTrips.filter(t=>{
      if(t.startTime<=simulationTime) {
        const path = interpolateTripPath(t);
        path.parentTrip = t;  // Store reference to parent trip        
        if(path.length) {
          tripPaths.push(path);
          // If inheriting marker from previous block, use it
          if (t._inheritedMarker) {
            vehicleMarkersWithActiveTrip.push(t._inheritedMarker);
            if(!allVehicleMarkers.includes(t._inheritedMarker)) {
              allVehicleMarkers.push(t._inheritedMarker);
            }else{
            }
          } else {
            const m = L.circleMarker([path[0].lat, path[0].lon], { radius: 6, color: 'green', fillColor: 'green', fillOpacity: 1 }).addTo(map);
            allVehicleMarkers.push(m);
            vehicleMarkersWithActiveTrip.push(m);
          }
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
        // Trip finished: try to connect to next trip with same block_id
        const finishedTrip =path.parentTrip;
        //console.log(`Trip ${finishedTrip.trip_id} finished at ${formatTime(endTime)}. Trying to find next connection`);

        if (finishedTrip){
            //update the veh-kilometer plot
            const shapePts = shapes.filter(s => s.shape_id === finishedTrip.shape_id);
            let tripDistanceKm = 0;
            if (shapePts.length > 1) {
              tripDistanceKm = shapeDistance(shapePts);
            }
            updateVehKmOnTripFinish(finishedTrip, tripDistanceKm, endTime);
        }

        if (finishedTrip && finishedTrip.block_id) {
          const tripsForBlock = blockIdTripMap[finishedTrip.block_id] || [];
          // Find the next trip with startTime > endTime
          const nextTrip = finishedTrip.nextTrip;
            if (nextTrip && nextTrip.startTime > endTime && remainingTrips.includes(nextTrip)) {
            // Calculate distance and layover
            const endPos = path[path.length - 1];
            const stopIds = tripStopsMap[nextTrip.trip_id];
            const startStopId = stopIds ? Array.from(stopIds)[0] : null;
            const startStop = stops.find(s => s.id === startStopId);
                    
            const dist = calculateDistance(endPos.lat, endPos.lon, startStop.lat, startStop.lon);
            const layover = nextTrip.startTime - endTime;
            if ((dist > 400 || layover > 7200) && (dist / layover > 5)) {
              let msg = `Block ${finishedTrip.block_id} involving trips ${finishedTrip.trip_id} and ${nextTrip.trip_id}: Layover ${Math.round(layover / 60)} min, Distance ${Math.round(dist)} m`;
              msg += " ALERT: This is not considered a connection although the trips share the same block_id";
              console.log(msg);
              //treat this case as if the block_id is miscoded, and the trip is not the same physical vehicle
            }else{              
              // Inherit marker for next trip
              nextTrip._inheritedMarker = vehicleMarkersWithActiveTrip[i];
              vehicleMarkersWithActiveTrip[i].setLatLng([startStop.lat, startStop.lon]); //move the marker to the start of the next trip
  
              // Remove path and marker from current arrays, but don't remove marker from map
              tripPaths.splice(i, 1);
              vehicleMarkersWithActiveTrip.splice(i, 1);              continue;
            }
          }
        }
        // No next trip: remove marker and path
        map.removeLayer(vehicleMarkersWithActiveTrip[i]);
        allVehicleMarkers = allVehicleMarkers.filter(m => m !== vehicleMarkersWithActiveTrip[i]); //remove from allVehicleMarkers        
        vehicleMarkersWithActiveTrip.splice(i, 1);
        tripPaths.splice(i, 1);
        continue;
      }
      // Animate marker as usual
      const idx = timedIndex(simulationTime, path);
      if (idx >= 0 && idx < path.length - 1) {
        const a = path[idx], b = path[idx + 1];
        const frac = (simulationTime - a.time) / (b.time - a.time);
        const lat = a.lat + (b.lat - a.lat) * frac;
        const lon = a.lon + (b.lon - a.lon) * frac;
        vehicleMarkersWithActiveTrip[i].setLatLng([lat, lon]);
      }
    }

    // Stop when no trips remain and all animated complete
    if (!remainingTrips.length && tripPaths.every(path => path[path.length - 1].time <= simulationTime)) {
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
  allVehicleMarkers.forEach(marker => {
    if (marker && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
  allVehicleMarkers = [];
  updateTripPlot(simulationTime, allVehicleMarkers.length); // Final update to trip plot

  // 3) Reset all trip/animation state
  tripPaths = [];
  remainingTrips = [];
  vehicleMarkersWithActiveTrip = [];

  // 4) Reset the clock
  simulationTime = null;
  document.getElementById('timeDisplay').textContent = '00:00:00';

  // 5) Reset pause button label
  const pauseButton = document.getElementById('pauseButton');
  if (pauseButton) pauseButton.textContent = '⏯️ Pause';
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
    pauseButton.textContent = '⏯️ Resume';
  }else{
    pauseButton.textContent = '⏯️ Pause';
      animationTimer = setInterval(() => {
      simulationTime += TIME_STEP_SEC * speedMultiplier;
      document.getElementById('timeDisplay').textContent = formatTime(simulationTime);
      UpdateVehiclePositions();
      updateTripPlot(simulationTime, allVehicleMarkers.length); // Add here too
      flushVehKmPendingPoints();
    }, FRAME_INTERVAL_MS);
  }
}

//speed control
function changeAnimationSpeed(){
    speedMultiplier = parseFloat(document.getElementById('speedSelect').value);
}

function showProgressBar() {
  document.getElementById('progressBarContainer').style.display = 'block';
  setProgressBar(0);
}
function setProgressBar(percent) {
  document.getElementById('progressBar').style.width = percent + '%';
}
function hideProgressBar() {
  document.getElementById('progressBarContainer').style.display = 'none';
}



// === Run on Load ===
window.addEventListener('DOMContentLoaded', () => {
  loadGtfsFromWebZip();
  
  document.getElementById('routeTypeSelect');
  document.getElementById('serviceIdSelect');
  document.getElementById('playBtn').addEventListener('click', () => {
    stopAnimation(); // Stop any existing animation first
    initializeAnimation();
    startAnimation();
  });

  document.getElementById('uploadGtfsBtn').addEventListener('click', () => {
    document.getElementById('gtfsFileInput').click();
  });
  document.getElementById('pauseButton').addEventListener('click', togglePauseResume);
  document.getElementById('stopBtn').addEventListener('click', stopAnimation);
  document.getElementById('speedSelect').addEventListener('change', changeAnimationSpeed);

  document.getElementById('updateMapBtn').addEventListener('click', function() {
    // Use the same logic as at the start of simulation
    stopAnimation();
    filterStopsAndShapesForTrips(filteredTrips);
  });

  document.getElementById('gtfsFileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      loadGtfsFromUserUploadZip(file);
      document.getElementById('dataSourceText').textContent = file.name;
    }
  });  
  initTripPlot();
  setupVehKmPlot();

  // Ribbon icon toggle logic (not mutually exclusive)
  document.querySelectorAll('.ribbon-icon').forEach(btn => {
    btn.addEventListener('click', function() {
      const canvasId = this.getAttribute('data-canvas');
      if (!canvasId) return;

      const canvas = document.getElementById(canvasId);
      const isActive = this.classList.contains('active');

      // Toggle active state and canvas visibility
      if (isActive) {
        this.classList.remove('active');
        if (canvas) canvas.style.display = 'none';
      } else {
        this.classList.add('active');
        if (canvas) canvas.style.display = 'flex';
      }
    });
  });

  // Tab logic for graphs and stats
  document.querySelectorAll('.canvas-header').forEach(header => {
    header.querySelectorAll('.tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', function() {
        // Remove active from all tabs in this header
        header.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        // Hide all tab-contents in this canvas
        const canvas = header.parentElement;
        canvas.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        // Activate this tab
        this.classList.add('active');
        const tabId = this.getAttribute('data-tab');
        canvas.querySelector(`#${tabId}`).classList.add('active');
      });
    });
  });

  // Close button logic
  document.getElementById('closeHelpBtn').onclick = function() {
    document.getElementById('helpCanvas').style.display = 'none';
    // Also deactivate the ribbon icon if needed
    document.querySelectorAll('.ribbon-icon[data-canvas="helpCanvas"]').forEach(btn => btn.classList.remove('active'));
  };

  // open the first canvas by default
  document.querySelector('.ribbon-icon[data-canvas="animationCanvas"]').click();
  document.querySelector('.ribbon-icon[data-canvas="helpCanvas"]').click();

  // Make some of the canvas draggable
  ['graphsCanvas', 'statsCanvas', 'helpCanvas'].forEach(canvasId => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const header = canvas.querySelector('.canvas-header');
    if (!header) return;

    header.style.cursor = 'move';
    let offsetX = 0, offsetY = 0, isDragging = false;

    header.addEventListener('mousedown', function(e) {
      isDragging = true;
      const rect = canvas.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      canvas.style.zIndex = 3000;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      canvas.style.left = (e.clientX - offsetX) + 'px';
      canvas.style.top = (e.clientY - offsetY) + 'px';
      canvas.style.right = 'auto';
      canvas.style.bottom = 'auto';
      canvas.style.position = 'fixed';
    });

    document.addEventListener('mouseup', function() {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
        setTimeout(() => { canvas.style.zIndex = 1500; }, 200);
      }
    });
  });
});


//#region Trip Plotting
let tripPlotChart = null;
let hourTicks = []; // Track which hour ticks have been added

let tripPlotData = {
  labels: [],
  datasets: [{
    label: 'Number of Active Trips',
    data: [],
    fill: true,
    backgroundColor: 'rgba(0,120,215,0.2)',
    borderColor: '#0078d7',
    tension: 0.2
  }]
};

function initTripPlot() {
  const ctx = document.getElementById('tripPlot').getContext('2d');
  tripPlotChart = new Chart(ctx, {
    type: 'line',
    data: tripPlotData,
    options: {
      responsive: true,
      animation: false,
      scales: {
        x: {
          title: { display: true, text: 'Time (HH:MM)' },
          ticks: {
            autoSkip: false,
            callback: function(value, index) {
              const label = this.chart.data.labels[index];
              // Show label if it's a whole hour
              if (/^\d{2}:00:00$/.test(label)) return label.substring(0, 5); // HH:MM
              return '';
            }
          }
        },
        y: {
          title: { display: true, text: 'Number of Active Trips' },
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            callback: function(value) {
              return Math.round(value);
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        title: { text: 'Number of Trips', display: true, font: { size: 14 } }
      }
    }
  });
}

function updateTripPlot(currentTime, activeTripsCount) {
  const lastTime = tripPlotData.labels.length > 0
  ? timeToSeconds(tripPlotData.labels[tripPlotData.labels.length - 1])
  : null;
  
  // Only record if at least 60 seconds since last record
  if (lastTime === null || currentTime - lastTime >= 60 || activeTripsCount === 0) {
    const timeLabel = formatTime(currentTime);
    tripPlotData.labels.push(timeLabel);
    tripPlotData.datasets[0].data.push(activeTripsCount);

    // Only insert hour tick if this is NOT the first data point
    if (tripPlotData.labels.length > 1) {
      const currentHour = Math.floor(currentTime / 3600);
      const hourLabel = formatTime(currentHour * 3600);
      if (
        hourTicks.length === 0 ||
        currentHour > hourTicks[hourTicks.length - 1]
      ) {
        hourTicks.push(currentHour);
        // Only add the hour label if not present
        if (!tripPlotData.labels.includes(hourLabel)) {
          // Insert the hour label at the correct position (before current timeLabel)
          const insertIndex = tripPlotData.labels.length - 1;
          tripPlotData.labels.splice(insertIndex, 0, hourLabel);
          // Do NOT add a data point for the hour label
        }
      }
    }

    tripPlotChart.update();
  }
}



// --- Vehicle-Kilometer Plot Setup ---
const vehKmColors = [
  "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
  "#ffff33", "#a65628", "#f781bf", "#999999", "#1b9e77"
];
let vehKmChart;
let vehKmData = {}; // { route_id: { label, color, data: [{x, y}], total } }
let vehKmTime = 0;  // Current simulation time in seconds

function setupVehKmPlot() {
  const ctx = document.getElementById('vehKmPlot').getContext('2d');
  vehKmChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: []
    },
    options: {
      responsive: true,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#222', font: { weight: 'bold' } }
        },
        title: {
          display: true,
          text: 'Cumulative Vehicle-Kilometers by Route',
          font: { size: 14 }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Animation Time (s)' },
          min: undefined, // will be set dynamically
          ticks: {
            // Only show ticks at whole hours
            stepSize: 3600,
            callback: function(value) {
              // Only show label if value is a whole hour
              if (value % 3600 === 0) {
                const h = Math.floor(value / 3600).toString().padStart(2, '0');
                return `${h}:00`;
              }
              return '';
            }
          }
        },
        y: {
          title: { display: true, text: 'Cumulative Vehicle-Kilometers' }
        }
      }
    }
  });
}

function updateVehKmOnTripFinish(trip, tripDistanceKm, simTime) {
  // Only track top 10 routes by cumulative km
  const routeId = trip.route_id;
  if (!vehKmData[routeId]) {
    const colorIdx = Object.keys(vehKmData).length % vehKmColors.length;
    vehKmData[routeId] = {
      label: getRouteLabel(routeId),
      color: vehKmColors[colorIdx],
      data: [],
      total: 0
    };
  }

 
  // Buffer the tripDistanceKm and simTime
  if (!vehKmPendingPoints[routeId]) vehKmPendingPoints[routeId] = [];
  vehKmPendingPoints[routeId].push({ x: simTime, distance: tripDistanceKm });
}

function flushVehKmPendingPoints() {
  Object.entries(vehKmPendingPoints).forEach(([routeId, points]) => {
    // Sort points by x (time)
    points.sort((a, b) => a.x - b.x);
    let routeObj = vehKmData[routeId];
    if (!routeObj) return;
    // Start from the last total
    let total = routeObj.data.length > 0 ? routeObj.data[routeObj.data.length - 1].y : 0;
    points.forEach(pt => {
      total += pt.distance;
      routeObj.data.push({ x: pt.x, y: total });
    });
    routeObj.total = total;
  });
  vehKmPendingPoints = {};

  // Keep only top 10 by total
  let sorted = Object.entries(vehKmData)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  vehKmChart.data.datasets = sorted.map(([routeId, obj]) => ({
    label: obj.label,
    data: obj.data,
    borderColor: obj.color,
    backgroundColor: obj.color,
    fill: false,
    tension: 0.1
  }));

  // Find the minimum x value among all datasets
  let minX = Infinity;
  vehKmChart.data.datasets.forEach(ds => {
    if (ds.data.length > 0) {
      const firstX = ds.data[0].x;
      if (firstX < minX) minX = firstX;
    }
  });
  if (minX !== Infinity) {
    vehKmChart.options.scales.x.min = Math.floor(minX / 3600) * 3600;
  }
  vehKmChart.update();
}

// Helper to get route label (short or long name)
function getRouteLabel(routeId) {
  const route = routes.find(r => r.route_id === routeId);
  if (!route) return routeId;
  // Show "short name - long name" (like in filters)
  if (route.route_short_name && route.route_long_name) {
    return `${route.route_short_name} - ${route.route_long_name}`;
  }
  return route.route_short_name || route.route_long_name || route.route_id;
}

//#endregion