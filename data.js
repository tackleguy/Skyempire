// SkyEmpire static data
const AIRPORTS = [
["ATL","Atlanta",5,33.6367,-84.4281],
["JFK","New York",5,40.6394,-73.7793],
["LAX","Los Angeles",5,33.9425,-118.408],
["LHR","London",5,51.4707,-0.4599],
["CDG","Paris",5,49.009,2.5541],
["DXB","Dubai",5,25.2498,55.371],
["HND","Tokyo",5,35.5497,139.787],
["PEK","Beijing",5,40.0773,116.5967],
["ORD","Chicago",4,41.9786,-87.9048],
["DFW","Dallas",4,32.8968,-97.038],
["SFO","San Francisco",4,37.6198,-122.3748],
["MIA","Miami",4,25.796,-80.2898],
["YYZ","Toronto",4,43.6759,-79.6294],
["FRA","Frankfurt",4,50.0267,8.5584],
["AMS","Amsterdam",4,52.3086,4.7639],
["MAD","Madrid",4,40.4934,-3.5722],
["IST","Istanbul",4,41.2749,28.7321],
["SIN","Singapore",4,1.3502,103.994],
["HKG","Hong Kong",4,22.3118,113.9149],
["ICN","Seoul",4,37.4691,126.451],
["SEA","Seattle",3,47.4479,-122.3103],
["DEN","Denver",3,39.86,-104.6738],
["BOS","Boston",3,42.362,-71.0079],
["MEX","Mexico City",3,19.4358,-99.0703],
["GRU","São Paulo",3,-23.4313,-46.47],
["EZE","Buenos Aires",3,-34.8222,-58.5358],
["MUC","Munich",3,48.3538,11.7861],
["FCO","Rome",3,41.8045,12.252],
["ZRH","Zurich",3,47.4581,8.5481],
["DOH","Doha",3,25.2731,51.6081],
["DEL","Delhi",3,28.5556,77.0952],
["BOM","Mumbai",3,19.0887,72.8679],
["BKK","Bangkok",3,13.6811,100.747],
["KUL","Kuala Lumpur",3,2.7456,101.71],
["SYD","Sydney",3,-33.9461,151.177],
["JNB","Johannesburg",3,-26.1401,28.2468],
["PHX","Phoenix",2,33.4353,-112.0059],
["MSP","Minneapolis",2,44.8801,-93.2217],
["AUS","Austin",2,30.1975,-97.662],
["YVR","Vancouver",2,49.1939,-123.184],
["LIM","Lima",2,-12.0219,-77.1143],
["BOG","Bogotá",2,4.7016,-74.1469],
["SCL","Santiago",2,-33.393,-70.7858],
["DUB","Dublin",2,53.4287,-6.2621],
["CPH","Copenhagen",2,55.6179,12.656],
["LIS","Lisbon",2,38.7813,-9.1359],
["ATH","Athens",2,37.9364,23.9445],
["CAI","Cairo",2,30.1115,31.3967],
["MEL","Melbourne",2,-37.6707,144.8379],
["AKL","Auckland",2,-37.012,174.7863],
["ANC","Anchorage",1,61.179,-149.9926],
["SJU","San Juan",1,18.4394,-66.0018],
["KEF","Reykjavík",1,63.985,-22.6056],
["MLA","Malta",1,35.8459,14.4915],
["NBO","Nairobi",1,-1.3189,36.9282],
["CMB","Colombo",1,7.1808,79.8841],
["CTS","Sapporo",1,42.7748,141.6904],
["OKA","Okinawa",1,26.1924,127.6398],
["PER","Perth",1,-31.9403,115.967],
["CUZ","Cusco",1,-13.5357,-71.9388]
].map(a=>({iata:a[0],city:a[1],tier:a[2],lat:a[3],lng:a[4]}));
const AP = {}; AIRPORTS.forEach(a=>AP[a.iata]=a);

const TIERS = {
 1:{pool:800, hubCost:2e6, maxBased:4, landing:1200, overhead:8e3},
 2:{pool:2000,hubCost:6e6, maxBased:8, landing:2500, overhead:18e3},
 3:{pool:4500,hubCost:15e6,maxBased:14,landing:4500, overhead:35e3},
 4:{pool:9000,hubCost:35e6,maxBased:22,landing:8000, overhead:70e3},
 5:{pool:16000,hubCost:80e6,maxBased:32,landing:14000,overhead:120e3}
};
const CARGO_POOL = {1:40,2:120,3:300,4:700,5:1400};

const FAMOUS = {"JFK-LAX":3.0,"HND-CTS":3.0,"LHR-JFK":2.5,"SIN-HKG":2.5,"CDG-LHR":2.2,"HND-OKA":2.2,"ICN-HND":2.0,"DXB-LHR":2.0,"ATL-ORD":1.8,"GRU-EZE":1.8,"SYD-MEL":2.5,"PEK-HKG":1.8,"MAD-LIS":1.6,"MIA-SJU":1.6,"FRA-IST":1.6};
function famousMult(a,b){return FAMOUS[a+"-"+b]||FAMOUS[b+"-"+a]||1;}
const WEEKDAY = [1.12,1.0,0.92,0.92,1.0,1.15,0.95]; // Sun..Sat (Date.getDay order); game day0=Mon

// [model, class, price, lease/mo(0=none), seats-or-payload, range, speed, fuel$/km, maint$/flt-hr, kind, classic]
const AIRCRAFT = [
["ATR 42-600","Turboprop",20e6,200e3,48,1300,550,4,450,"pax",false],
["ATR 72-600","Turboprop",26e6,260e3,78,1500,510,5,500,"pax",false],
["CRJ900","Regional",24e6,240e3,90,2900,830,8,650,"pax",false],
["E175-E2","Regional",28e6,280e3,88,3700,840,8,620,"pax",false],
["E195-E2","Regional",35e6,340e3,132,4800,850,10,700,"pax",false],
["A220-300","Regional",42e6,400e3,145,6200,850,11,720,"pax",false],
["A320neo","Narrowbody",58e6,520e3,186,6300,870,14,900,"pax",false],
["737 MAX 8","Narrowbody",56e6,500e3,189,6500,860,14,920,"pax",false],
["A321neo","Narrowbody",65e6,580e3,232,6900,870,16,980,"pax",false],
["737 MAX 10","Narrowbody",63e6,560e3,224,6100,860,16,990,"pax",false],
["A321XLR","Narrowbody",72e6,640e3,220,8700,870,17,1050,"pax",false],
["787-9","Widebody",145e6,1.2e6,296,14000,900,28,1900,"pax",false],
["A330-900","Widebody",130e6,1.1e6,310,13300,890,30,2000,"pax",false],
["A350-900","Widebody",160e6,1.35e6,325,15000,910,30,2050,"pax",false],
["787-10","Widebody",155e6,1.3e6,336,11900,900,31,2100,"pax",false],
["777-300ER","Widebody",175e6,1.5e6,396,13600,900,38,2500,"pax",false],
["A350-1000","Large",190e6,1.6e6,410,16100,910,37,2450,"pax",false],
["777-9","Large",210e6,1.75e6,426,13900,900,40,2600,"pax",false],
["747-8","Jumbo",200e6,1.7e6,467,14300,910,46,2900,"pax",false],
["A380","Jumbo",235e6,1.95e6,575,15200,910,54,3300,"pax",false],
["A320ceo","Narrowbody",26e6,0,180,5700,840,17,1100,"pax",true],
["737-800","Narrowbody",28e6,0,189,5400,840,17,1150,"pax",true],
["767-300ER","Widebody",45e6,0,269,11000,850,34,2400,"pax",true],
["747-400","Jumbo",55e6,0,416,13400,910,52,3100,"pax",true],
["ATR 72F","Feeder",22e6,220e3,8,1400,510,5,520,"cargo",false],
["737-800BCF","Classic",30e6,0,23,3700,840,17,1200,"cargo",true],
["767-300F","Medium",95e6,850e3,52,6000,850,30,2100,"cargo",false],
["A330-200F","Medium",115e6,1.0e6,70,7400,870,33,2200,"cargo",false],
["777F","Heavy",180e6,1.55e6,102,9200,900,40,2600,"cargo",false],
["747-8F","Heavy",215e6,1.8e6,137,8100,910,48,3000,"cargo",false]
].map(a=>({model:a[0],cls:a[1],price:a[2],lease:a[3],cap:a[4],range:a[5],speed:a[6],fuel:a[7],maint:a[8],kind:a[9],classic:a[10]}));
const AC = {}; AIRCRAFT.forEach(a=>AC[a.model]=a);
const BELLY = {Widebody:12,Large:15,Jumbo:18};

const LEVELS = [0,75e6,150e6,300e6,600e6,1.2e9,2.5e9,5e9,10e9,20e9]; // net worth threshold for level i+1

const RIVALS = [
 {name:"Pacific Azure",code:"PA",base:"HND",color:"#38BDF8",routes:[["HND","CTS"],["HND","OKA"],["HND","ICN"],["HND","SIN"],["HND","BKK"],["HND","SYD"],["HND","LAX"],["ICN","HKG"]]},
 {name:"Iberia Star",code:"IS",base:"MAD",color:"#F472B6",routes:[["MAD","LIS"],["MAD","LHR"],["MAD","CDG"],["MAD","FCO"],["MAD","GRU"],["MAD","EZE"],["MAD","JFK"]]},
 {name:"Condor West",code:"CW",base:"DFW",color:"#FBBF24",routes:[["DFW","LAX"],["DFW","ORD"],["DFW","MIA"],["DFW","JFK"],["DFW","MEX"],["DFW","SEA"],["DFW","LHR"]]}
];
const RIVAL_CANDIDATES = [["HND","HKG"],["HND","DEL"],["ICN","SIN"],["MAD","AMS"],["MAD","ZRH"],["MAD","DUB"],["MAD","ATH"],["DFW","YVR"],["DFW","BOG"],["DFW","BOS"],["DFW","SFO"],["HND","PER"],["MAD","CAI"],["DFW","LIM"]];

const ACHIEVEMENTS = [
 {id:"first_route",name:"First Route",desc:"Open your first route",icon:"🛫"},
 {id:"first_profit",name:"First Profitable Day",desc:"End a day in the black",icon:"💵"},
 {id:"ac5",name:"5 Aircraft",desc:"Own or lease 5 aircraft",icon:"✈️"},
 {id:"ac10",name:"10 Aircraft",desc:"Own or lease 10 aircraft",icon:"🛩️"},
 {id:"first_wide",name:"First Widebody",desc:"Acquire a widebody",icon:"🐋"},
 {id:"queen",name:"Queen of the Skies",desc:"Own a 747 — any variant",icon:"👑"},
 {id:"superjumbo",name:"Superjumbo",desc:"Own an A380",icon:"🐘"},
 {id:"vintage",name:"Vintage Collector",desc:"Own 3 classics",icon:"🕰️"},
 {id:"first_freighter",name:"First Freighter",desc:"Acquire a freighter",icon:"📦"},
 {id:"cargo_mogul",name:"Cargo Mogul",desc:"Fly 10,000 tonnes of cargo",icon:"🏗️"},
 {id:"hubs3",name:"3 Hubs",desc:"Operate 3 hubs",icon:"🏢"},
 {id:"hubs5",name:"5 Hubs",desc:"Operate 5 hubs",icon:"🏙️"},
 {id:"intercont",name:"First Intercontinental",desc:"Open a route over 7,000 km",icon:"🌍"},
 {id:"pax50k",name:"50K Passengers",desc:"Carry 50,000 passengers",icon:"🧳"},
 {id:"pax500k",name:"500K Passengers",desc:"Carry 500,000 passengers",icon:"🌐"},
 {id:"nw500m",name:"$500M Net Worth",desc:"Reach $500M net worth",icon:"💰"},
 {id:"nw5b",name:"$5B Net Worth",desc:"Reach $5B net worth",icon:"🏦"},
 {id:"perfect_week",name:"Perfect Week",desc:"7 straight profitable days",icon:"🔥"}
];

const PATTERNS = ["solid","cheatline","swoosh","split","retro","tailfade","belly","wave"];
const LOGOS = ["bird","star","globe","arrow","sun","mountain","wave","diamond","crescent","ring","leaf","bolt"];
