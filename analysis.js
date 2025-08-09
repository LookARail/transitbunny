
function generateRouteStatsTable(filteredTrips, shapes, stops, stopTimes, routes) {
  // Map shape_id to its shape points
  const shapesById = {};
  shapes.forEach(s => {
    if (!shapesById[s.shape_id]) shapesById[s.shape_id] = [];
    shapesById[s.shape_id].push(s);
  });

  // Precompute stopIdToName map
  const stopIdToName = {};
  stops.forEach(s => { stopIdToName[s.id] = s.name; });

   // Precompute stopIdToName map

  const tripStopsMap = {};
  stopTimes.forEach(st => {
  if (!tripStopsMap[st.trip_id]) tripStopsMap[st.trip_id] = [];
    tripStopsMap[st.trip_id].push(st);
  });
  // Sort each trip's stops by stop_sequence
  Object.values(tripStopsMap).forEach(stopsArr => {
    stopsArr.sort((a, b) => a.stop_sequence - b.stop_sequence);
  });

  // Map route_id to route_name
  const routeNames = {};
  routes.forEach(r => {
    routeNames[r.route_id] = r.route_long_name || r.route_short_name || r.route_id;
  });

  // Group trips by route and shape_id
  const stats = {};
  filteredTrips.forEach(trip => {
    const routeName = routeNames[trip.route_id];
    if (!stats[routeName]) stats[routeName] = {};
    if (!stats[routeName][trip.shape_id]) stats[routeName][trip.shape_id] = [];
    stats[routeName][trip.shape_id].push(trip);
  });

  // Helper: calculate shape distance
  function shapeDistance(shapePts) {
    //Sort by shape_pt_sequence
    shapePts.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);

    // Check for shape_dist_traveled values
    const traveledValues = shapePts
        .map(pt => pt.shape_dist_traveled)
        .filter(val => val !== undefined && val !== null);

    if (traveledValues.length > 0) {
        //If available, return the maximum value
        //console.log(`For shapeID ${shapePts[0].shape_id} Using shape_dist_traveled values:`, Math.max(...traveledValues));
        return Math.max(...traveledValues);
    } else {
        //Otherwise, calculate manually
        let dist = 0;
        for (let i = 1; i < shapePts.length; i++) {
        dist += 0.001 * calculateDistance(
            shapePts[i - 1].lat, shapePts[i - 1].lon,
            shapePts[i].lat, shapePts[i].lon
        ); // Convert to kilometers
        }
        return dist;
    }
  }

  // Helper: get first/last station for a trip
  function getFirstLastStations(trip) {
    //console.log(`For trip${trip.trip_id}. Trying to find first and last stations.`);

    const tripStops = stopTimes.filter(st => st.trip_id === trip.trip_id)
      .sort((a, b) => a.stop_sequence - b.stop_sequence);
    const firstStopName = stopIdToName[tripStops[0].stop_id] || '';
    const lastStopName = stopIdToName[tripStops[tripStops.length - 1].stop_id] || '';
    return [firstStopName, lastStopName];
  }

  // Helper: get travel times for all trips with shape_id
  function getTravelTimes(trips) {
    //console.log(`Computing Travel Time`);

    return trips.map(trip => {
        const tripStops = tripStopsMap[trip.trip_id] || [];
        if (tripStops.length < 2) return null;
        const start = timeToSeconds(tripStops[0].departure_time || tripStops[0].arrival_time);
        const end = timeToSeconds(tripStops[tripStops.length - 1].arrival_time || tripStops[tripStops.length - 1].departure_time);
        return end - start;
    }).filter(t => t !== null);
  }

  // Build table rows
  const rows = [];
  Object.entries(stats).forEach(([routeName, shapesObj]) => {
    Object.entries(shapesObj).forEach(([shape_id, tripsArr]) => {
      //console.log(`ShapeID ${shape_id}`);

      const shapePts = shapesById[shape_id] || [];
      const distance = shapePts.length > 1 ? Number(shapeDistance(shapePts).toFixed(3)) : 0;
      const [firstStation, lastStation] = getFirstLastStations(tripsArr[0]);
      const travelTimes = getTravelTimes(tripsArr);
      const shortest = travelTimes.length ? Math.round(Math.min(...travelTimes) / 60 * 10) / 10 : '';
      const longest = travelTimes.length ? Math.round(Math.max(...travelTimes) / 60 * 10) / 10 : '';
      const average = travelTimes.length  ? Math.round((travelTimes.reduce((a, b) => a + b, 0) / travelTimes.length) / 60 * 10) / 10  : '';
      const tripCount = tripsArr.length;

      rows.push({
        route_name: routeName,
        shape_id,
        first_station: firstStation,
        last_station: lastStation,
        distance,
        trip_count: tripCount,
        shortest,
        average,
        longest,
      });
    });
  });

  // Render table to a canvas or HTML table
  renderStatsTable(rows);
}

// Store generated rows for download
let lastStatsRows = [];

// Example rendering as HTML table (you can adapt for canvas)
function renderStatsTable(rows) {
  lastStatsRows = rows; // Save for download

  const container = document.getElementById('routeStatsTable');
  let html = `<table>
    <thead>
      <tr>
        <th>Route Name</th><th>Shape ID</th><th>First Station</th><th>Last Station</th>
        <th>Distance (km)</th><th>Trip Count</th><th>Shortest (min)</th><th>Average (min)</th><th>Longest (min)</th>
      </tr>
    </thead>
    <tbody>`;
  rows.forEach(row => {
    html += `<tr>
      <td>${row.route_name}</td>
      <td>${row.shape_id}</td>
      <td>${row.first_station}</td>
      <td>${row.last_station}</td>
      <td>${row.distance}</td>
      <td>${row.trip_count}</td>
      <td>${row.shortest}</td>
      <td>${row.average}</td>
      <td>${row.longest}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

function downloadStatsCSV(rows) {
  if (!rows || !rows.length) return;
  const headers = [
    "Route Name", "Shape ID", "First Station", "Last Station",
    "Distance (km)",  "Trip Count","Shortest (min)", "Average (min)", "Longest (min)"
  ];
  const csvRows = [
    headers.join(","),
    ...rows.map(row =>
      [
        row.route_name,
        row.shape_id,
        `"${row.first_station.replace(/"/g, '""')}"`,
        `"${row.last_station.replace(/"/g, '""')}"`,
        row.distance,
        row.trip_count,
        row.shortest,
        row.average,
        row.longest
      ].join(",")
    )
  ];
  const csvContent = csvRows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "route_statistics.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Utility functions (reuse from main.js or import)
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


// === Run on Load ===
window.addEventListener('DOMContentLoaded', () => {

  document.getElementById('GenerateStat').addEventListener('click', () => {
    console.log('Generating route statistics...');
    generateRouteStatsTable(filteredTrips, shapes, stops, stopTimes, routes);    
  });

  document.getElementById('DownloadStat').addEventListener('click', () => {
    if (!lastStatsRows || lastStatsRows.length === 0) {
      alert("No statistics available to download. Please generate statistics first.");
      return;
    }
    downloadStatsCSV(lastStatsRows);  });
});