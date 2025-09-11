importScripts('libs/papaparse.min.js');
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

// Utility to parse generic CSV into array of rows (objects keyed by header)
function parseCSVToObjects(text, fileLabel) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  postProgress(fileLabel, 1);
  return rows;
}

onmessage = async function (e) {
  try {
    const { zipFile } = e.data;
    postMessage({ type: 'status', message: 'Worker: starting parsing' });

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
      const stops = parseCSVToObjects(stopsText, 'stops.txt');
      const stopsById = {};
      for (const obj of stops) {
        const id = obj.stop_id ? obj.stop_id.trim() : '';
        obj.id = id;
        obj.name = obj.stop_name ? obj.stop_name.trim() : '';
        obj.lat = parseFloat(obj.stop_lat);
        obj.lon = parseFloat(obj.stop_lon);
        if (id) stopsById[id] = obj;
      }
      results.stops = stops;
      results.stopsById = stopsById;
    }

    // --- routes ---
    if (zipFile['routes.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding routes.txt' });
      const routesText = decodeBytes(zipFile['routes.txt']);
      const routes = parseCSVToObjects(routesText, 'routes.txt');
      results.routes = routes;
    }

    // --- trips ---
    if (zipFile['trips.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding trips.txt' });
      const tripsText = decodeBytes(zipFile['trips.txt']);
      const trips = parseCSVToObjects(tripsText, 'trips.txt');
      results.trips = trips;
    }

    // --- shapes (group and compute distance) ---
    if (zipFile['shapes.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding shapes.txt' });
      const shapesText = decodeBytes(zipFile['shapes.txt']);
      const shapes = parseCSVToObjects(shapesText, 'shapes.txt');
      const shapesById = {};
      for (const obj of shapes) {
        const sid = obj.shape_id ? obj.shape_id.trim() : '';
        obj.lat = parseFloat(obj.shape_pt_lat);
        obj.lon = parseFloat(obj.shape_pt_lon);
        obj.sequence = parseInt(obj.shape_pt_sequence, 10);
        obj.shape_dist_traveled = obj.shape_dist_traveled !== undefined ? parseFloat(obj.shape_dist_traveled) : undefined;
        if (!shapesById[sid]) shapesById[sid] = [];
        shapesById[sid].push(obj);
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
      results.shapes = shapes;
      results.shapesById = shapesById;
      results.shapeIdToDistance = shapeIdToDistance;
    }

    // --- stop_times (build stopTimesByTripId + tripStartTimeMap & tripStopsMap) ---
    if (zipFile['stop_times.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding stop_times.txt' });
      const stText = decodeBytes(zipFile['stop_times.txt']);
      const stop_times = parseCSVToObjects(stText, 'stop_times.txt');
      const stopTimesByTripId = {};
      const tripStartTimeMap = {};
      const tripStopsMap = {};
      for (const stObj of stop_times) {
        const tripId = stObj.trip_id ? stObj.trip_id.trim() : '';
        const stopId = stObj.stop_id ? stObj.stop_id.trim() : '';
        const seq = parseInt(stObj.stop_sequence, 10) || 0;
        const arrival = stObj.arrival_time ? stObj.arrival_time.trim() : '';
        const departure = stObj.departure_time ? stObj.departure_time.trim() : (arrival || '');
        const departureSec = departure ? timeToSeconds(departure) : null;
        stObj.arrival_time = arrival;
        stObj.departure_time = departure;
        stObj.stop_sequence = seq;
        stObj.departure_sec = departureSec;

        if (!stopTimesByTripId[tripId]) stopTimesByTripId[tripId] = [];
        stopTimesByTripId[tripId].push(stObj);

        if (!tripStopsMap[tripId]) tripStopsMap[tripId] = new Set();
        if (stopId) tripStopsMap[tripId].add(stopId);

        if (departureSec !== null) {
          const t = tripStartTimeMap[tripId];
          if (t === undefined || departureSec < t) tripStartTimeMap[tripId] = departureSec;
        }
      }
      // sort stop_times per trip
      Object.keys(stopTimesByTripId).forEach(tid => {
        stopTimesByTripId[tid].sort((a,b) => a.stop_sequence - b.stop_sequence);
      });
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
      const calRows = parseCSVToObjects(calText, 'calendar.txt');
      const cal = [];
      for (const obj of calRows) {
        cal.push({
          service_id: obj.service_id,
          days: {
            monday: +obj.monday,
            tuesday: +obj.tuesday,
            wednesday: +obj.wednesday,
            thursday: +obj.thursday,
            friday: +obj.friday,
            saturday: +obj.saturday,
            sunday: +obj.sunday
          },
          start_date: obj.start_date,
          end_date: obj.end_date
        });
      }
      results.calendar = cal;
    }

    if (zipFile['calendar_dates.txt']) {
      postMessage({ type: 'status', message: 'Worker: decoding calendar_dates.txt' });
      const cdText = decodeBytes(zipFile['calendar_dates.txt']);
      const cdRows = parseCSVToObjects(cdText, 'calendar_dates.txt');
      const cds = [];
      for (const obj of cdRows) {
        cds.push({
          service_id: obj.service_id,
          date: obj.date,
          exception_type: +obj.exception_type
        });
      }
      results.calendar_dates = cds;
    }

    postMessage({ type: 'status', message: 'Worker: parsing complete' });
    postMessage({ type: 'done', results });
  } catch (err) {
    postMessage({ type: 'error', message: err.message || String(err) });
  }
};
