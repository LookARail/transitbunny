// gtfsWorker.js
// Worker that receives an object mapping filenames -> Uint8Array (uncompressed file bytes).
// It parses GTFS files and posts progress/status messages back to the main thread.

// Helper: decode ArrayBuffer/Uint8Array to string
function decodeBytes(arr) {
  const decoder = new TextDecoder('utf-8');
  // if it's already ArrayBuffer
  if (arr instanceof ArrayBuffer) return decoder.decode(new Uint8Array(arr));
  // if it's Uint8Array
  return decoder.decode(arr);
}

// Very small safe CSV split (naive, keeps behaviour consistent with your original code).
// This intentionally mirrors your split(',') approach for drop-in compatibility.
function splitRow(line) {
  return line.split(',').map(c => c === undefined ? '' : c.trim());
}

function timeToSeconds(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.length !== 3) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Post helper
function postProgress(file, pct) {
  postMessage({ type: 'progress', file, progress: pct });
}

onmessage = async function (e) {
  try {
    const { zipFile } = e.data;
    postMessage({ type: 'status', message: 'Worker: starting parsing' });

    // Utility to parse generic CSV into array of rows (objects keyed by header)
    function parseCSVToObjects(text, fileLabel, reportEvery = 2000) {
      const lines = text.trim().split(/\r?\n/);
      if (!lines.length) return [];
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = splitRow(line);
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
          obj[headers[j]] = cols[j] === undefined ? '' : cols[j];
        }
        rows.push(obj);
        if ((i % reportEvery) === 0) {
          postProgress(fileLabel, i / lines.length);
        }
      }
      postProgress(fileLabel, 1);
      return rows;
    }

    // Results object to send back
    const results = {
      stops: null,
      routes: null,
      trips: null,
      shapes: null,
      stop_times: null,
      calendar: null,
      calendar_dates: null,
      // indexes
      stopsById: null,
      shapesById: null,
      shapeIdToDistance: null,
      stopTimesByTripId: null,
      tripStartTimeMap: null,
      tripStopsMap: null
    };

    // --- stops ---
    if (zipFile['stops.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding stops.txt' });
      const stopsText = decodeBytes(zipFile['stops.txt']);
      // parse into map + array
      const lines = stopsText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const idIndex = headers.indexOf('stop_id');
      const nameIndex = headers.indexOf('stop_name');
      const latIndex = headers.indexOf('stop_lat');
      const lonIndex = headers.indexOf('stop_lon');

      const stops = [];
      const stopsById = {};
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        const obj = {
          id: cols[idIndex] ? cols[idIndex].trim() : '',
          name: cols[nameIndex] ? cols[nameIndex].trim() : '',
          lat: parseFloat(cols[latIndex]),
          lon: parseFloat(cols[lonIndex])
        };
        stops.push(obj);
        if (obj.id) stopsById[obj.id] = obj;
        if (i % 2000 === 0) postProgress('stops.txt', i / lines.length);
      }
      postProgress('stops.txt', 1);
      results.stops = stops;
      results.stopsById = stopsById;
    }

    // --- routes ---
    if (zipFile['routes.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding routes.txt' });
      const routesText = decodeBytes(zipFile['routes.txt']);
      const lines = routesText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const routeIdIndex = headers.indexOf('route_id');
      const shortNameIndex = headers.indexOf('route_short_name');
      const longNameIndex = headers.indexOf('route_long_name');
      const typeIndex = headers.indexOf('route_type');

      const routes = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        routes.push({
          route_id: cols[routeIdIndex],
          route_short_name: cols[shortNameIndex] || '',
          route_long_name: cols[longNameIndex] || '',
          route_type: cols[typeIndex]
        });
        if (i % 2000 === 0) postProgress('routes.txt', i / lines.length);
      }
      postProgress('routes.txt', 1);
      results.routes = routes;
    }

    // --- trips ---
    if (zipFile['trips.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding trips.txt' });
      const tripsText = decodeBytes(zipFile['trips.txt']);
      const lines = tripsText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const routeIdIndex = headers.indexOf('route_id');
      const serviceIdIndex = headers.indexOf('service_id');
      const tripIdIndex = headers.indexOf('trip_id');
      const shapeIdIndex = headers.indexOf('shape_id');
      const blockIDIndex = headers.indexOf('block_id');
      const directionIdIndex = headers.indexOf('direction_id');

      const trips = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        trips.push({
          route_id: cols[routeIdIndex],
          service_id: cols[serviceIdIndex],
          trip_id: cols[tripIdIndex],
          shape_id: shapeIdIndex !== -1 ? cols[shapeIdIndex] : undefined,
          block_id: blockIDIndex !== -1 ? cols[blockIDIndex] : undefined,
          direction_id: directionIdIndex !== -1 ? cols[directionIdIndex] : undefined
        });
        if (i % 2000 === 0) postProgress('trips.txt', i / lines.length);
      }
      postProgress('trips.txt', 1);
      results.trips = trips;
    }

    // --- shapes (group and compute distance) ---
    if (zipFile['shapes.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding shapes.txt' });
      const shapesText = decodeBytes(zipFile['shapes.txt']);
      const lines = shapesText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const shapeIDIndex = headers.indexOf('shape_id');
      const shapeLatIndex = headers.indexOf('shape_pt_lat');
      const shapeLonIndex = headers.indexOf('shape_pt_lon');
      const shapeSeqIndex = headers.indexOf('shape_pt_sequence');
      const shapeDistIndex = headers.indexOf('shape_dist_traveled');

      const shapes = [];
      const shapesById = {};
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        const sid = cols[shapeIDIndex] ? cols[shapeIDIndex].trim() : '';
        const lat = parseFloat(cols[shapeLatIndex]);
        const lon = parseFloat(cols[shapeLonIndex]);
        const seq = parseInt(cols[shapeSeqIndex], 10);
        const dist = shapeDistIndex !== -1 ? parseFloat(cols[shapeDistIndex]) : undefined;
        const obj = { shape_id: sid, lat, lon, sequence: seq, shape_dist_traveled: dist };
        shapes.push(obj);
        if (!shapesById[sid]) shapesById[sid] = [];
        shapesById[sid].push(obj);
        if (i % 5000 === 0) postProgress('shapes.txt', i / lines.length);
      }

      // sort and compute cumulative distances
      const shapeIdToDistance = {};
      Object.keys(shapesById).forEach(id => {
        const arr = shapesById[id];
        arr.sort((a, b) => a.sequence - b.sequence);
        // compute cumulative distances
        let cum = 0;
        for (let k = 1; k < arr.length; k++) {
          const a = arr[k-1], b = arr[k];
          // haversine (approx)
          const R = 6371000;
          const toRad = deg => deg * Math.PI / 180;
          const dLat = toRad(b.lat - a.lat);
          const dLon = toRad(b.lon - a.lon);
          const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
          const d = R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
          cum += d;
        }
        shapeIdToDistance[id] = cum;
      });

      postProgress('shapes.txt', 1);
      results.shapes = shapes;
      results.shapesById = shapesById;
      results.shapeIdToDistance = shapeIdToDistance;
    }

    // --- stop_times (build stopTimesByTripId + tripStartTimeMap & tripStopsMap) ---
    if (zipFile['stop_times.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding stop_times.txt' });
      const stText = decodeBytes(zipFile['stop_times.txt']);
      const lines = stText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const idx = {
        trip_id: headers.indexOf('trip_id'),
        arrival_time: headers.indexOf('arrival_time'),
        departure_time: headers.indexOf('departure_time'),
        stop_id: headers.indexOf('stop_id'),
        stop_sequence: headers.indexOf('stop_sequence')
      };

      const stop_times = [];
      const stopTimesByTripId = {};
      const tripStartTimeMap = {};
      const tripStopsMap = {};

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        const tripId = cols[idx.trip_id] ? cols[idx.trip_id].trim() : '';
        const stopId = cols[idx.stop_id] ? cols[idx.stop_id].trim() : '';
        const seq = parseInt(cols[idx.stop_sequence], 10) || 0;
        const arrival = cols[idx.arrival_time] ? cols[idx.arrival_time].trim() : '';
        const departure = cols[idx.departure_time] ? cols[idx.departure_time].trim() : (arrival || '');
        const departureSec = departure ? timeToSeconds(departure) : null;
        const stObj = {
          trip_id: tripId,
          arrival_time: arrival,
          departure_time: departure,
          stop_id: stopId,
          stop_sequence: seq,
          departure_sec: departureSec
        };
        stop_times.push(stObj);

        if (!stopTimesByTripId[tripId]) stopTimesByTripId[tripId] = [];
        stopTimesByTripId[tripId].push(stObj);

        if (!tripStopsMap[tripId]) tripStopsMap[tripId] = new Set();
        if (stopId) tripStopsMap[tripId].add(stopId);

        if (departureSec !== null) {
          const t = tripStartTimeMap[tripId];
          if (t === undefined || departureSec < t) tripStartTimeMap[tripId] = departureSec;
        }
        if (i % 2000 === 0) postProgress('stop_times.txt', i / lines.length);
      }

      // sort stop_times per trip
      Object.keys(stopTimesByTripId).forEach(tid => {
        stopTimesByTripId[tid].sort((a,b) => a.stop_sequence - b.stop_sequence);
      });

      postProgress('stop_times.txt', 1);
      results.stop_times = stop_times;
      results.stopTimesByTripId = stopTimesByTripId;
      results.tripStartTimeMap = tripStartTimeMap;
      // convert sets to arrays for structured clone
      const tripStopsMapObj = {};
      Object.keys(tripStopsMap).forEach(k => { tripStopsMapObj[k] = Array.from(tripStopsMap[k]); });
      results.tripStopsMap = tripStopsMapObj;
    }

    // --- calendar & calendar_dates (optional) ---
    if (zipFile['calendar.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding calendar.txt' });
      const calText = decodeBytes(zipFile['calendar.txt']);
      const lines = calText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const idx = {};
      ['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date'].forEach(k => {
        idx[k] = headers.indexOf(k);
      });
      const cal = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        cal.push({
          service_id: cols[idx['service_id']],
          days: {
            monday: +cols[idx['monday']],
            tuesday: +cols[idx['tuesday']],
            wednesday: +cols[idx['wednesday']],
            thursday: +cols[idx['thursday']],
            friday: +cols[idx['friday']],
            saturday: +cols[idx['saturday']],
            sunday: +cols[idx['sunday']]
          },
          start_date: cols[idx['start_date']],
          end_date: cols[idx['end_date']]
        });
        if (i % 200 === 0) postProgress('calendar.txt', i / lines.length);
      }
      postProgress('calendar.txt', 1);
      results.calendar = cal;
    }

    if (zipFile['calendar_dates.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding calendar_dates.txt' });
      const cdText = decodeBytes(zipFile['calendar_dates.txt']);
      const lines = cdText.trim().split(/\r?\n/);
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const idx = {
        service_id: headers.indexOf('service_id'),
        date: headers.indexOf('date'),
        exception_type: headers.indexOf('exception_type')
      };
      const cds = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        if (!row) continue;
        const cols = splitRow(row);
        cds.push({
          service_id: cols[idx.service_id],
          date: cols[idx.date],
          exception_type: +cols[idx.exception_type]
        });
        if (i % 200 === 0) postProgress('calendar_dates.txt', i / lines.length);
      }
      postProgress('calendar_dates.txt', 1);
      results.calendar_dates = cds;
    }

    postMessage({ type: 'status', message: 'Worker: parsing complete' });
    postMessage({ type: 'done', results });
  } catch (err) {
    postMessage({ type: 'error', message: err.message || String(err) });
  }
};
