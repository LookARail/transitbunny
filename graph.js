
let tripPlotChart = null;
let hourTicks = []; 

let tripPlotData = {
  labels: [],
  datasets: [
    {
      label: 'Service Date 1',
      data: [],
      fill: true,
      backgroundColor: 'rgba(0,120,215,0.2)',
      borderColor: '#0078d7',
      tension: 0.2
    },
    {
      label: 'Service Date 2',
      data: [],
      fill: true,
      backgroundColor: 'rgba(255,120,0,0.2)',
      borderColor: '#ff7f00',
      tension: 0.2
    }
  ]
};



function initTripPlot() {
  const ctx = document.getElementById('tripPlot').getContext('2d');
  tripPlotChart = new Chart(ctx, {
    type: 'line',
    data: tripPlotData,
    options: {      
      responsive: true,
      aspectRatio: 16 / 10,       
      animation: false,
      scales: {
        x: {
          type: 'linear',           
          title: { display: true, text: 'Time (HH:MM)' },
          ticks: {
            autoSkip: false,
            stepSize: 3600, 
            callback: function(value) {
              const h = Math.floor(value / 3600).toString().padStart(2, '0');
              return `${h}:00`;
            }
          }
        },
        y: {
          title: { display: true, text: 'Number of Active Vehicles' },
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
        legend: { display: true, position: 'bottom' },
        title: { text: 'Number of Vehicles', display: true, font: { size: 14 } },
        tooltip: {
          callbacks: {
            title: function(context) {
              const value = context[0].parsed.x;
              const h = Math.floor(value / 3600).toString().padStart(2, '0');
              const m = Math.floor((value % 3600) / 60).toString().padStart(2, '0');
              return `${h}:${m}`;
            }
          }        
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'y'
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true 
            },
            mode: 'y'
          },
          limits: {
            y: { min: 0 }
          }
        }        
      }
    }
  });


  tripPlotChart.update();
}

function updateTripPlot(currentTime) {
  let count1 = 0, count2 = 0;
  for (const m of allVehicleMarkers) {
    if (m.parentTrip && window.tripIds1 && window.tripIds1.has(m.parentTrip.trip_id)) count1++;
    if (m.parentTrip && window.tripIds2 && window.tripIds2.has(m.parentTrip.trip_id)) count2++;
  }

  const ds0 = tripPlotChart.data.datasets[0].data;
  const lastTime = ds0 && ds0.length > 0 ? ds0[ds0.length - 1].x : null;

  if (lastTime === null) {
    const zeroTime = currentTime - (TIME_STEP_SEC * speedMultiplier);
    tripPlotChart.data.datasets[0].data.push({ x: zeroTime, y: 0 });
    tripPlotChart.data.datasets[1].data.push({ x: zeroTime, y: 0 });
  }

  if (lastTime === null || currentTime - lastTime >= 60 || (count1 === 0 && count2 === 0)) {
    tripPlotChart.data.datasets[0].data.push({ x: currentTime, y: count1 });
    if (tripPlotChart.data.datasets[1]) {
      tripPlotChart.data.datasets[1].data.push({ x: currentTime, y: count2 });
    }
    
    const sdSel = document.getElementById('serviceDateSelect');
    const selectedLabels = Array.from(sdSel.selectedOptions).map(o => o.text);
    tripPlotChart.data.datasets[0].label = selectedLabels[0] || "Service Date 1";
    if (selectedLabels.length > 1) {
      tripPlotChart.data.datasets[1].label = selectedLabels[1];
      tripPlotChart.data.datasets[1].hidden = false;
    } else {
      tripPlotChart.data.datasets[1].label = "";
      tripPlotChart.data.datasets[1].hidden = true;
    }
    const hasData2 = selectedLabels.length > 1;
    tripPlotChart.data.datasets[1].hidden = !hasData2;
    tripPlotChart.options.plugins.legend.display = hasData2;

    tripPlotChart.update();
  }
}




const vehKmColors = [
  "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
  "#ffff33", "#a65628", "#f781bf", "#999999", "#1b9e77"
];
let vehKmChart;
let vehKmData = []; 
let vehKmTime = 0; 

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
          aspectRatio: 16 / 10, 
          position: 'top',
          labels: { color: '#222', font: { weight: 'bold' } }
        },
        title: {
          display: true,
          text: 'Cumulative Vehicle-Kilometers by Route',
          font: { size: 14 }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'y'
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true 
            },
            mode: 'y'
          },
          limits: {
            y: { min: 0 } 
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Animation Time (s)' },
          min: undefined, 
          ticks: {
            stepSize: 3600,
            callback: function(value) {
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
  const routeId = trip.route_id;
  const sdSel = document.getElementById('serviceDateSelect');
  const selectedLabels = Array.from(sdSel.selectedOptions).map(o => o.text);

  if (window.tripIds1 && window.tripIds1.has(trip.trip_id)){
    const key = `${trip.route_id}__${selectedLabels[0]}`;
    if (!vehKmData[key]) {
      const colorIdx = Object.keys(vehKmData).length % vehKmColors.length;
      vehKmData[key] = {
        label: `${getRouteLabel(routeId)}  (${selectedLabels[0]})`,
        color: vehKmColors[colorIdx],
        data: [],
        total: 0
      };
    }

    if (!vehKmPendingPoints[key]) vehKmPendingPoints[key] = [];
    vehKmPendingPoints[key].push({ x: simTime, distance: tripDistanceKm });
  } 
  if (window.tripIds2 && window.tripIds2.has(trip.trip_id)){
    const key = `${trip.route_id}__${selectedLabels[1]}`;
    if (!vehKmData[key]) {
      const colorIdx = Object.keys(vehKmData).length % vehKmColors.length;
      vehKmData[key] = {
        label: `${getRouteLabel(routeId)}  (${selectedLabels[1]})`,
        color: vehKmColors[colorIdx],
        data: [],
        total: 0
      };
    }

    if (!vehKmPendingPoints[key]) vehKmPendingPoints[key] = [];
    vehKmPendingPoints[key].push({ x: simTime, distance: tripDistanceKm });
  } 
 }

function flushVehKmPendingPoints() {
  Object.entries(vehKmPendingPoints).forEach(([key, points]) => {
    points.sort((a, b) => a.x - b.x);
    let routeObj = vehKmData[key];
    if (!routeObj) return;
    let total = routeObj.data.length > 0 ? routeObj.data[routeObj.data.length - 1].y : 0;
    points.forEach(pt => {
      total += pt.distance;
      routeObj.data.push({ x: pt.x, y: total });
    });
    routeObj.total = total;
  });
  vehKmPendingPoints = {};

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

function getRouteLabel(routeId) {
  const route = routes.find(r => r.route_id === routeId);
  if (!route) return routeId;
  if (route.route_short_name && route.route_long_name) {
    return `${route.route_short_name} - ${route.route_long_name}`;
  }
  return route.route_short_name || route.route_long_name || route.route_id;
}


let tripsPerHourChart;
let tripsPerHourColors = vehKmColors; 
let lastTripsPerHourUpdateHour = null;
let tripsPerHourSeries = {};
let hasOneDirectionalHourInPlot = false;
let mostCommonShapeIdByRouteDir = {}; 
let mostCommonShapeDistByRouteDir = {};

// Roster chart variables
let rosterChart = null;
let rosterData = {}; // { block_id: [{trip_id, startTime, endTime, distance, shape_id, color}] }
let rosterBlockIds = []; // ordered list of block_ids for Y-axis
let rosterBlockIdCounter = 0;
let rosterShapeColors = {}; // { shape_id: color }
let rosterLastBlockCount = 0; // (legacy) used to track canvas resize
let rosterUserInteracted = false; // once user pans/zooms, stop auto-following latest blocks
let rosterColorPalette = [
  "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
  "#ffff33", "#a65628", "#f781bf", "#999999", "#1b9e77",
  "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02",
  "#a6761d", "#666666", "#8dd3c7", "#bebada", "#fb8072"
]; 

function buildMostCommonShapeIdByRouteDir() {
  mostCommonShapeIdByRouteDir = {};
  mostCommonShapeDistByRouteDir = {};

  const countMap = {};
  trips.forEach(trip => {
    const routeId = trip.route_id;
    const dir = trip.direction_id ?? 'none';
    const shapeId = trip.shape_id;
    if (!countMap[routeId]) countMap[routeId] = {};
    if (!countMap[routeId][dir]) countMap[routeId][dir] = {};
    countMap[routeId][dir][shapeId] = (countMap[routeId][dir][shapeId] || 0) + 1;
  });

  Object.entries(countMap).forEach(([routeId, dirMap]) => {
    mostCommonShapeIdByRouteDir[routeId] = {};
    mostCommonShapeDistByRouteDir[routeId] = {};
    Object.entries(dirMap).forEach(([dir, shapeCounts]) => {
      let maxCount = -1, mostCommonShapeId = null;
      Object.entries(shapeCounts).forEach(([shapeId, count]) => {
        if (count > maxCount) {
          maxCount = count;
          mostCommonShapeId = shapeId;
        }
      });
      mostCommonShapeIdByRouteDir[routeId][dir] = mostCommonShapeId;
      mostCommonShapeDistByRouteDir[routeId][dir] = shapeIdToDistance[mostCommonShapeId] || 1;
    });
  });
}

function setupTripsPerHourPlot() {
  lastTripsPerHourUpdateHour = null;
  tripsPerHourSeries = {};

  const ctx = document.getElementById('tripsPerHourPlot').getContext('2d');
  tripsPerHourChart = new Chart(ctx, {
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
          aspectRatio: 16 / 10, 
          labels: { color: '#222', font: { weight: 'bold' } }
        },
        title: {
          display: true,
          text: 'Estimated Headway (mm:ss) by Route',
          font: { size: 14 }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'y'
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true 
            },
            mode: 'y'
          },
          limits: {
            y: { min: 0 }
          }
        }        
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Hour of Day' },
          ticks: {
            stepSize: 1,
            callback: function(value) {
              return `${value}:00`;
            }
          }
        },
        y: {
          title: { display: true, text: 'Estimated Headway (mm:ss)' },
          beginAtZero: true,
          ticks: {
            stepSize: 1,
            callback: function(value) {
                if (value == null || !isFinite(value)) return '';
                const mins = Math.floor(value);
                const secs = Math.round((value - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              }
          }
        }
      }
    }
  });

}

function updateHeadwayPlotForHour(hour) {
  const hasDirectionId = trips.some(t => t.direction_id !== undefined && t.direction_id !== '');

  const sdSel = document.getElementById('serviceDateSelect');
  const selectedLabels = Array.from(sdSel.selectedOptions).map(o => o.text);
  let serviceDateLabel = null;

  const hourTrips = {};
  filteredTrips.forEach(trip => {
    const routeId = trip.route_id;
    const startTime = tripStartTimeAndStopMap[trip.trip_id]?.departureTimeSec ?? null;
    if (startTime == null) return;
    const tripHour = Math.floor(startTime / 3600);
    if (tripHour !== hour) return;

    const dir = hasDirectionId ? (trip.direction_id ?? 'none') : 'none';

    if (window.tripIds1 && window.tripIds1.has(trip.trip_id)){
      serviceDateLabel = selectedLabels[0];
      const routeKey = `${trip.route_id}__${serviceDateLabel}`;
      if (!hourTrips[routeKey]) hourTrips[routeKey] = {};
      if (!hourTrips[routeKey][dir]) hourTrips[routeKey][dir] = [];
      hourTrips[routeKey][dir].push(trip);
    } 
    if (window.tripIds2 && window.tripIds2.has(trip.trip_id)){
      serviceDateLabel = selectedLabels[1];
      const routeKey = `${trip.route_id}__${serviceDateLabel}`;
      if (!hourTrips[routeKey]) hourTrips[routeKey] = {};
      if (!hourTrips[routeKey][dir]) hourTrips[routeKey][dir] = [];
      hourTrips[routeKey][dir].push(trip);
    } 
  });

  const hourCounts = {};
  Object.keys(hourTrips).forEach(routeKey => {
    hourCounts[routeKey] = {};
    Object.keys(hourTrips[routeKey]).forEach(dir => {
      const tripsArr = hourTrips[routeKey][dir];
      const dists = tripsArr.map(trip => shapeIdToDistance[trip.shape_id] || 0);
      const commonDist = mostCommonShapeDistByRouteDir[routeKey] && mostCommonShapeDistByRouteDir[routeKey][dir]
        ? mostCommonShapeDistByRouteDir[routeKey][dir]
        : 1;
      const normalized = dists.map(d => d >= commonDist ? 1 : d / commonDist);
      hourCounts[routeKey][dir] = normalized.reduce((a, b) => a + b, 0);
    });

  });

  Object.keys(hourCounts).forEach(routeKey => {
    if (!tripsPerHourSeries[routeKey]) tripsPerHourSeries[routeKey] = [];
    let yValue, annotation = null, pointStyle = 'circle';

    if (!hasDirectionId) {
      yValue = Object.values(hourCounts[routeKey]).reduce((a, b) => a + b, 0);
    } else {
      const dirs = Object.keys(hourCounts[routeKey]);
      if (dirs.length === 2) {
        yValue = (hourCounts[routeKey]['0'] + hourCounts[routeKey]['1']) / 2;
      } else if (dirs.length === 1) {
        hasOneDirectionalHourInPlot = true; 
        yValue = hourCounts[routeKey][dirs[0]];
        annotation = 'Only one direction present';
        pointStyle = 'rectRot'; 
      }
    }

    if (yValue < 1) yValue = 1;
    tripsPerHourSeries[routeKey].push({ x: hour, y: yValue, annotation, pointStyle });
  });

  Object.keys(tripsPerHourSeries).forEach(routeKey => {
    const last = tripsPerHourSeries[routeKey][tripsPerHourSeries[routeKey].length - 1];
    if (last.x < hour) {
      tripsPerHourSeries[routeKey].push({ x: hour, y: 0 });
    }
  });

  let totals = Object.entries(tripsPerHourSeries).map(([routeKey, arr]) => ({
    routeKey,
    total: arr.reduce((sum, pt) => sum + pt.y, 0)
  }));
  totals.sort((a, b) => b.total - a.total);
  let top10 = totals.slice(0, 10).map(t => t.routeKey);

  tripsPerHourChart.data.datasets = top10.map((routeKey, idx) => {
    const color = tripsPerHourColors[idx % tripsPerHourColors.length];
    return {
      label: getRouteLabel(routeKey.split('__')[0]) + (routeKey.split('__')[1] ? ` (${routeKey.split('__')[1]})` : ''),
      data: tripsPerHourSeries[routeKey],
      borderColor: color,
      backgroundColor: color,
      fill: false,
      tension: 0.1,
      pointStyle: ctx => {
        const i = ctx.dataIndex;
        const pt = tripsPerHourSeries[routeKey][i];
        return pt && pt.pointStyle ? pt.pointStyle : 'circle';
      },
      pointRadius: ctx => {
        const i = ctx.dataIndex;
        const pt = tripsPerHourSeries[routeKey][i];
        if (!pt) return 3;
        if (pt.y === 0) return 1; 
        if (pt.pointStyle === 'rectRot') return 10; 
        return 5; 
      },
      pointHoverRadius: ctx => {
        const i = ctx.dataIndex;
        const pt = tripsPerHourSeries[routeKey][i];
        if (!pt) return 4;
        if (pt.y === 0) return 2;
        if (pt.pointStyle === 'rectRot') return 12;
        return 7;
      }
    };
  });

  if (tripsPerHourChart.data.datasets.length > 0 && tripsPerHourChart.options.scales.x.min === undefined) {
    const firstDs = tripsPerHourChart.data.datasets[0];
    if (firstDs.data.length > 0) {
      tripsPerHourChart.options.scales.x.min = firstDs.data[0].x;
    }
  }
  let maxX = -Infinity;
  tripsPerHourChart.data.datasets.forEach(ds => {
    if (ds.data.length > 0) {
      const lastX = ds.data[ds.data.length - 1].x;
      if (lastX > maxX) maxX = lastX;
    }
  });
  if (maxX !== -Infinity) {
    tripsPerHourChart.options.scales.x.max = maxX;
  }

  Object.values(tripsPerHourSeries).forEach(series => {
    const pt = series[series.length - 1];
    if (pt) {
      if (pt.y > 0) {
        pt.y = 60 / pt.y;
      } else {
        pt.y = null;
      }
    }
  });

  tripsPerHourChart.update();

  const annotationDiv = document.getElementById('tripsPerHourAnnotation');
  if (annotationDiv) {
    let annotationText = '';
    if (!hasDirectionId) {
      annotationText= 'Note: direction_id column not found in trips.txt. Headway estimation treats every trip as the same direction and could be inaccurate.';
    }
    if (hasOneDirectionalHourInPlot) {
      if (annotationText) annotationText += ' ';
      annotationText += 'Diamond datapoint represents that the trips are one-directional during this hour.';
    }
    
    annotationDiv.textContent = annotationText;
    annotationDiv.style.display = annotationText ? 'block' : 'none';    
  }
}


// ============================================================================
// ROSTER CHART FUNCTIONS
// ============================================================================

function getColorForShape(shape_id) {
  if (!shape_id) return '#999999';
  if (rosterShapeColors[shape_id]) return rosterShapeColors[shape_id];
  
  const colorIndex = Object.keys(rosterShapeColors).length % rosterColorPalette.length;
  rosterShapeColors[shape_id] = rosterColorPalette[colorIndex];
  return rosterShapeColors[shape_id];
}

function setupRosterPlot() {
  console.log('[ROSTER] setupRosterPlot called');
  const ctx = document.getElementById('rosterPlot').getContext('2d');
  rosterChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        title: { 
          display: true, 
          text: 'Block Roster Diagram',
          font: { size: 14 }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const dataPoint = context.raw;
              
              // Get first and last stations for this trip
              const tripStops = stopTimes.filter(st => st.trip_id === dataPoint.trip_id)
                .sort((a, b) => a.stop_sequence - b.stop_sequence);
              
              let firstStation = 'N/A';
              let lastStation = 'N/A';
              
              if (tripStops.length > 0) {
                const firstStop = stops.find(s => s.id === tripStops[0].stop_id);
                const lastStop = stops.find(s => s.id === tripStops[tripStops.length - 1].stop_id);
                firstStation = firstStop?.name || 'Unknown';
                lastStation = lastStop?.name || 'Unknown';
              }
              
              return [
                `Trip: ${dataPoint.trip_id}`,
                `From: ${firstStation}`,
                `To: ${lastStation}`,
                `Distance: ${dataPoint.distance.toFixed(2)} km`
              ];
            }
          }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy',
            threshold: 5,
            onPanStart: function({chart}) {
              rosterUserInteracted = true;
              console.log('[ROSTER] Pan started');
              return true;
            },
            onPan: function({chart}) {
              console.log('[ROSTER] Panning...');
            },
            onPanComplete: function({chart}) {
              console.log('[ROSTER] Pan complete');
            }
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true 
            },
            mode: 'xy',
            onZoomStart: function({chart}) {
              rosterUserInteracted = true;
              console.log('[ROSTER] Zoom started');
              return true;
            },
            onZoomComplete: function({chart}) {
              console.log('[ROSTER] Zoom complete');
            }
          },
          limits: {
            y: { min: -0.5, max: 'original' },
            x: { min: 'original', max: 'original' }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Time (HH:MM)' },
          ticks: {
            stepSize: 3600,
            callback: function(value) {
              const h = Math.floor(value / 3600).toString().padStart(2, '0');
              return `${h}:00`;
            }
          }
        },
        y: {
          type: 'linear',
          title: { display: true, text: 'Block' },
          min: -0.5,
          offset: false,
          grid: {
            offset: false
          },
          ticks: {
            stepSize: 1,
            callback: function(value) {
              const index = Math.round(value);
              if (index >= 0 && index < rosterBlockIds.length) {
                return `#${index + 1}: ${rosterBlockIds[index]}`;
              }
              return '';
            }
          }
        }
      }
    }
  });
  
  console.log('[ROSTER] Chart created with pan enabled:', rosterChart.options.plugins.zoom.pan);
  
  // Add debug event listeners
  const canvas = document.getElementById('rosterPlot');
  let dragStart = null;
  
  canvas.addEventListener('mousedown', function(e) {
    dragStart = {x: e.clientX, y: e.clientY, time: Date.now()};
    console.log('[ROSTER] MOUSEDOWN at:', e.clientX, e.clientY);
  });
  
  canvas.addEventListener('mousemove', function(e) {
    if (e.buttons === 1 && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      console.log('[ROSTER] MOUSEMOVE (dragging) delta:', dx, dy);
    }
  });
  
  canvas.addEventListener('mouseup', function(e) {
    if (dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const duration = Date.now() - dragStart.time;
      console.log('[ROSTER] MOUSEUP - drag complete. Delta:', dx, dy, 'Duration:', duration + 'ms');
      dragStart = null;
    }
  });
  
  canvas.addEventListener('click', function(e) {
    console.log('[ROSTER] CLICK detected at:', e.clientX, e.clientY);
  });
  
  // Log when zoom plugin pan events fire
  console.log('[ROSTER] Pan callbacks registered:', {
    onPanStart: typeof rosterChart.options.plugins.zoom.pan.onPanStart,
    onPan: typeof rosterChart.options.plugins.zoom.pan.onPan,
    onPanComplete: typeof rosterChart.options.plugins.zoom.pan.onPanComplete
  });
}

function shouldIncludeInRoster(trip) {
  // Only include if trip is in tripIds1 (first selected service date)
  const inTripIds1 = window.tripIds1 && window.tripIds1.has(trip.trip_id);
  
  if (!inTripIds1) {
    return false;
  }
  
  // Get first selected route from filter
  const routeSelect = document.getElementById('routeShortNameSelect');
  if (!routeSelect || !routeSelect.selectedOptions.length) {
    return false;
  }
  const firstSelectedRoute = routeSelect.selectedOptions[0].value;
  
  // Check if trip matches the route
  const tripRoute = routes.find(r => r.route_id === trip.route_id);
  const routeFullName = `${tripRoute?.route_short_name}-${tripRoute?.route_long_name}`;
  
  return routeFullName === firstSelectedRoute;
}

function addTripToRoster(trip, startTime, endTime, distance) {
  
  const shouldInclude = shouldIncludeInRoster(trip);
  
  if (!shouldInclude) return;
  
  const blockId = trip.block_id || `no_block_${rosterBlockIdCounter++}`;
  const shapeId = trip.shape_id || 'no_shape';
  
  
  // Add block_id to list if not present
  if (!rosterData[blockId]) {
    rosterData[blockId] = [];
    rosterBlockIds.push(blockId);
  }
  
  const color = getColorForShape(shapeId);
  
  rosterData[blockId].push({
    trip_id: trip.trip_id,
    startTime: startTime,
    endTime: endTime,
    distance: distance,
    shape_id: shapeId,
    color: color
  });
  
  
  updateRosterChart();
}

function updateRosterChart() {
  if (!rosterChart) return;
  
  console.log('[ROSTER] updateRosterChart called, blocks:', rosterBlockIds.length);
  
  // Step 1: Build datasets from current data
  const shapeDatasets = {};
  
  rosterBlockIds.forEach((blockId, blockIndex) => {
    const trips = rosterData[blockId];
    if (!trips) return;
    
    trips.forEach(tripData => {
      if (!shapeDatasets[tripData.shape_id]) {
        shapeDatasets[tripData.shape_id] = {
          label: tripData.shape_id,
          data: [],
          backgroundColor: tripData.color,
          borderColor: tripData.color,
          borderWidth: 1,
          pointRadius: 0,
          pointHitRadius: 10,
          showLine: false
        };
      }
      
      const midTime = (tripData.startTime + tripData.endTime) / 2;
      shapeDatasets[tripData.shape_id].data.push({
        x: midTime,
        y: blockIndex,
        startTime: tripData.startTime,
        endTime: tripData.endTime,
        trip_id: tripData.trip_id,
        distance: tripData.distance,
        width: tripData.endTime - tripData.startTime,
        color: tripData.color
      });
    });
  });
  
  rosterChart.data.datasets = Object.values(shapeDatasets);
  
  // Step 2: Calculate what the data bounds are
  const dataYMax = rosterBlockIds.length - 0.5;
  let dataXMax = 0;
  Object.values(rosterData).forEach(trips => {
    trips.forEach(trip => {
      if (trip.endTime > dataXMax) dataXMax = trip.endTime;
    });
  });

  // Step 2b: Keep the chart UI size fixed (do NOT resize canvas as blocks grow).
  // Instead, when there are too many blocks to display nicely, auto-show the latest N blocks
  // (as if the user panned down to the newest rows). Once the user pans/zooms, stop auto-follow.
  if (!rosterUserInteracted && rosterBlockIds.length > 0) {
    const minRowPx = 12; // minimum readable row height
    const fallbackPlotHeight = rosterChart.height || document.getElementById('rosterPlot')?.clientHeight || 500;
    const plotHeightPx = rosterChart.chartArea
      ? (rosterChart.chartArea.bottom - rosterChart.chartArea.top)
      : fallbackPlotHeight;

    const visibleRows = Math.max(8, Math.floor(plotHeightPx / minRowPx));
    if (rosterBlockIds.length > visibleRows) {
      const startIndex = rosterBlockIds.length - visibleRows;
      rosterChart.options.scales.y.min = startIndex - 0.5;
      rosterChart.options.scales.y.max = dataYMax;
      console.log('[ROSTER] Auto-follow latest blocks. Showing rows', startIndex, 'to', rosterBlockIds.length - 1);
    } else {
      rosterChart.options.scales.y.min = -0.5;
      rosterChart.options.scales.y.max = dataYMax;
    }
  }
  
  // Step 3: Get current axis limits from the chart (these are controlled by zoom/pan)
  const currentYMax = rosterChart.options.scales.y.max;
  const currentXMax = rosterChart.options.scales.x.max;
  
  console.log('[ROSTER] Data bounds - Y:', dataYMax, 'X:', dataXMax);
  console.log('[ROSTER] Current axis - Y:', currentYMax, 'X:', currentXMax);
  
  // Step 4: Only EXPAND limits if data exceeds current view (never shrink)
  let needsUpdate = false;
  
  if (currentYMax == null || !isFinite(currentYMax) || dataYMax > currentYMax) {
    console.log('[ROSTER] Expanding Y-axis from', currentYMax, 'to', dataYMax);
    rosterChart.options.scales.y.max = dataYMax;
    needsUpdate = true;
  }
  
  if (currentXMax == null || !isFinite(currentXMax) || dataXMax > currentXMax) {
    console.log('[ROSTER] Expanding X-axis from', currentXMax, 'to', dataXMax);
    rosterChart.options.scales.x.max = dataXMax;
    needsUpdate = true;
  }
  
  // Step 6: Update the chart
  rosterChart.update('none');
  
  if (needsUpdate) {
    console.log('[ROSTER] Axis limits expanded, view updated');
  }
}

function resetRosterChart() {
  console.log('[ROSTER] Reset called');
  rosterData = {};
  rosterBlockIds = [];
  rosterBlockIdCounter = 0;
  rosterShapeColors = {};
  rosterLastBlockCount = 0;
  rosterUserInteracted = false;
  
  if (rosterChart) {
    rosterChart.data.datasets = [];
    rosterChart.options.scales.y.min = -0.5;
    rosterChart.options.scales.y.max = 0.5;
    rosterChart.options.scales.x.max = 3600; // Start at 1 hour
    rosterChart.update('none');
  }
}

// Custom drawing plugin for roster rectangles
const rosterRectanglePlugin = {
  id: 'rosterRectangles',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'rosterPlot') return;    
   
    const ctx = chart.ctx;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    
    // Save context and set up clipping region
    ctx.save();
    
    // Clip to chart area to prevent drawing outside bounds
    const chartArea = chart.chartArea;
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
    ctx.clip();
    
    const yMin = yScale.min;
    const yMax = yScale.max;
    const rowPxEstimate = (() => {
      if (!isFinite(yMin) || !isFinite(yMax)) return 20;
      const p0 = yScale.getPixelForValue(yMin);
      const p1 = yScale.getPixelForValue(yMin + 1);
      const d = Math.abs(p1 - p0);
      return isFinite(d) && d > 0 ? d : 20;
    })();

    const rectHeight = Math.max(3, Math.min(18, rowPxEstimate * 0.75));
    
    chart.data.datasets.forEach(dataset => {
      dataset.data.forEach(point => {
        if (!point.startTime || !point.endTime) return;
        // Skip rows outside the current visible window (helps performance for large rosters)
        if (isFinite(yMin) && isFinite(yMax) && (point.y < yMin - 0.5 || point.y > yMax + 0.5)) return;
        
        const xStart = xScale.getPixelForValue(point.startTime);
        const xEnd = xScale.getPixelForValue(point.endTime);
        const yCenter = yScale.getPixelForValue(point.y);
        
        const rectWidth = xEnd - xStart;
        
        ctx.fillStyle = point.color;
        ctx.fillRect(xStart, yCenter - rectHeight/2, rectWidth, rectHeight);
        
        // Add border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(xStart, yCenter - rectHeight/2, rectWidth, rectHeight);
      });
    });
    
    // Restore context
    ctx.restore();
  }
};

// Register the custom plugin
if (typeof Chart !== 'undefined') {
  Chart.register(rosterRectanglePlugin);
}
