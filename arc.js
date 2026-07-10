// arc.js v1.0.0 (https://github.com/springmeyer/arc.js, BSD-2-Clause) — bundled as a browser global
(function(){
/**
 * Round coordinate decimal values to 6 places for precision
 *
 * @param coords - A coordinate position (longitude, latitude, optional elevation)
 * @returns Rounded coordinate position
 *
 * @example
 * ```typescript
 * const coords = [45.123456789, 50.987654321];
 * const roundedCoords = roundCoords(coords);
 * console.log(roundedCoords); // [45.123457, 50.987654]
 * ```
 */
function roundCoords(coords) {
    // round coordinate decimal values to 6 places
    const PRECISION = 6;
    const MULTIPLIER = Math.pow(10, PRECISION);
    const rounded = [];
    for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        if (coord !== undefined) {
            // NOTE: This logic follows https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
            rounded[i] = Math.round((coord + Number.EPSILON) * MULTIPLIER) / MULTIPLIER;
        }
    }
    return rounded;
}
/**
 * Convert degrees to radians
 */
const D2R = Math.PI / 180;
/**
 * Convert radians to degrees
 */
const R2D = 180 / Math.PI;


/**
 * Coordinate class representing a point with longitude and latitude
 *
 * @param lon - Longitude value
 * @param lat - Latitude value
 *
 * @example
 * ```typescript
 * const coord = new Coord(45.123456789, 50.987654321);
 * console.log(coord.lon); // 45.123457
 * console.log(coord.lat); // 50.987654
 * ```
 */
class Coord {
    lon;
    lat;
    x;
    y;
    constructor(lon, lat) {
        this.lon = lon;
        this.lat = lat;
        this.x = D2R * lon;
        this.y = D2R * lat;
    }
    /**
     * Get a string representation of the coordinate
     *
     * @returns String representation of the coordinate
     *
     * @example
     * ```typescript
     * const coord = new Coord(45.123456789, 50.987654321);
     * console.log(coord.view()); // "45.123457,50.987654"
     * ```
     */
    view() {
        return String(this.lon).slice(0, 4) + ',' + String(this.lat).slice(0, 4);
    }
    /**
     * Get the antipodal point (diametrically opposite point on the sphere)
     *
     * @returns Antipodal point
     *
     * @example
     * ```typescript
     * const coord = new Coord(45.123456789, 50.987654321);
     * console.log(coord.antipode()); // Coord { lon: -45.123457, lat: -50.987654 }
     * ```
     */
    antipode() {
        const anti_lat = -1 * this.lat;
        const anti_lon = (this.lon < 0) ? 180 + this.lon : (180 - this.lon) * -1;
        return new Coord(anti_lon, anti_lat);
    }
}

/**
 * Arc class representing the result of great circle calculations
 *
 * @param properties - Optional properties object
 *
 * @example
 * ```typescript
 * const arc = new Arc({ x: 45.123456789, y: 50.987654321 });
 * console.log(arc.json()); // { type: 'Feature', geometry: { type: 'LineString', coordinates: [ [Array] ] }, properties: { x: 45.123457, y: 50.987654 } }
 * ```
 */
class Arc {
    properties = {};
    geometries = [];
    constructor(properties) {
        if (properties)
            this.properties = properties;
    }
    /**
     * Convert to GeoJSON Feature
     *
     * @returns GeoJSON Feature with LineString or MultiLineString geometry
     *
     * @example
     * ```typescript
     * const gc = new GreatCircle({x: -122, y: 48}, {x: -77, y: 39});
     * const arc = gc.Arc(3);
     * console.log(arc.json());
     * // { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-122, 48], [-99.5, 43.5], [-77, 39]] }, properties: {} }
     * ```
     */
    json() {
        // Handle empty case
        if (this.geometries.length === 0) {
            return {
                type: 'Feature',
                // NOTE: coordinates: null is non-standard GeoJSON (RFC 7946 specifies empty array []) but maintained for backward compatibility with original arc.js behavior.
                geometry: { type: 'LineString', coordinates: null },
                properties: this.properties
            };
        }
        // Handle single LineString
        if (this.geometries.length === 1) {
            const firstGeometry = this.geometries[0];
            if (!firstGeometry) {
                return {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: [] },
                    properties: this.properties
                };
            }
            return {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: firstGeometry.coords },
                properties: this.properties
            };
        }
        // Handle multiple LineStrings as MultiLineString
        const coordinates = this.geometries
            .filter(geom => geom !== undefined)
            .map(geom => geom.coords);
        return {
            type: 'Feature',
            geometry: { type: 'MultiLineString', coordinates },
            properties: this.properties
        };
    }
    /**
     * Convert to WKT (Well Known Text) format
     *
     * @returns WKT string representation
     *
     * @example
     * ```typescript
     * const arc = new Arc({ name: 'test-arc' });
     * console.log(arc.wkt()); // "LINESTRING EMPTY" or "LINESTRING(lon lat,lon lat,...)"
     * ```
     */
    wkt() {
        if (this.geometries.length === 0) {
            return '';
        }
        let wktParts = [];
        for (const geometry of this.geometries) {
            if (!geometry || geometry.coords.length === 0) {
                wktParts.push('LINESTRING EMPTY');
                continue;
            }
            const coordStrings = geometry.coords
                .filter(coord => coord !== undefined)
                .map(coord => {
                const lon = coord[0] ?? 0;
                const lat = coord[1] ?? 0;
                return `${lon} ${lat}`;
            });
            if (coordStrings.length === 0) {
                wktParts.push('LINESTRING EMPTY');
            }
            else {
                wktParts.push(`LINESTRING(${coordStrings.join(',')})`);
            }
        }
        return wktParts.join('; ');
    }
}

/**
 * Internal LineString class for building geometries
 */
class _LineString {
    coords = [];
    length = 0;
    /**
     * Add a coordinate to the line string
     *
     * @param coord - Coordinate position to add
     */
    move_to(coord) {
        this.length++;
        this.coords.push(coord);
    }
}





// Number of bisection iterations used to locate the antimeridian crossing.
// More iterations = higher precision but more interpolate() calls.
// 50 iterations yields sub-degree precision, which is more than sufficient for most web mapping applications (i.e., not survey grade).
const ANTIMERIDIAN_BISECTION_ITERATIONS = 50;
/**
 * Great Circle calculation class
 * http://en.wikipedia.org/wiki/Great-circle_distance
 *
 * @param start - Start point
 * @param end - End point
 * @param properties - Optional properties object
 *
 * @example
 * ```typescript
 * const greatCircle = new GreatCircle({ x: 45.123456789, y: 50.987654321 }, { x: 46.123456789, y: 51.987654321 });
 * console.log(greatCircle.interpolate(0.5)); // [45.623457, 51.487654]
 * ```
 */
class GreatCircle {
    start;
    end;
    properties;
    g;
    constructor(start, end, properties) {
        if (!start || start.x === undefined || start.y === undefined) {
            throw new Error("GreatCircle constructor expects two args: start and end objects with x and y properties");
        }
        if (!end || end.x === undefined || end.y === undefined) {
            throw new Error("GreatCircle constructor expects two args: start and end objects with x and y properties");
        }
        this.start = new Coord(start.x, start.y);
        this.end = new Coord(end.x, end.y);
        this.properties = properties || {};
        const w = this.start.x - this.end.x;
        const h = this.start.y - this.end.y;
        const z = Math.pow(Math.sin(h / 2.0), 2) +
            Math.cos(this.start.y) *
                Math.cos(this.end.y) *
                Math.pow(Math.sin(w / 2.0), 2);
        this.g = 2.0 * Math.asin(Math.sqrt(z));
        if (this.g === Math.PI) {
            throw new Error('it appears ' + this.start.view() + ' and ' + this.end.view() + " are 'antipodal', e.g diametrically opposite, thus there is no single route but rather infinite");
        }
        else if (isNaN(this.g)) {
            throw new Error('could not calculate great circle between ' + start + ' and ' + end);
        }
    }
    /**
     * Interpolate along the great circle
     * http://williams.best.vwh.net/avform.htm#Intermediate
     *
     * @param f - Interpolation factor
     * @returns Interpolated point
     *
     * @example
     * ```typescript
     * const greatCircle = new GreatCircle({ x: 45.123456789, y: 50.987654321 }, { x: 46.123456789, y: 51.987654321 });
     * console.log(greatCircle.interpolate(0.5)); // [45.623457, 51.487654]
     * ```
     */
    interpolate(f) {
        const A = Math.sin((1 - f) * this.g) / Math.sin(this.g);
        const B = Math.sin(f * this.g) / Math.sin(this.g);
        const x = A * Math.cos(this.start.y) * Math.cos(this.start.x) + B * Math.cos(this.end.y) * Math.cos(this.end.x);
        const y = A * Math.cos(this.start.y) * Math.sin(this.start.x) + B * Math.cos(this.end.y) * Math.sin(this.end.x);
        const z = A * Math.sin(this.start.y) + B * Math.sin(this.end.y);
        const lat = R2D * Math.atan2(z, Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)));
        const lon = R2D * Math.atan2(y, x);
        return [lon, lat];
    }
    /**
     * Generate points along the great circle
     *
     * @param npoints - Number of points to generate
     * @param options - Optional options object
     * @returns Arc object
     *
     * @example
     * ```typescript
     * const greatCircle = new GreatCircle({ x: 45.123456789, y: 50.987654321 }, { x: 46.123456789, y: 51.987654321 });
     * console.log(greatCircle.Arc(10)); // Arc { geometries: [ [Array] ] }
     * ```
     */
    Arc(npoints = 100, _options) {
        // NOTE: With npoints ≤ 2, no antimeridian splitting is performed.
        // A 2-point antimeridian route returns a single LineString spanning ±180°. Renderers that support coordinate wrapping (e.g. MapLibre GL JS) handle this correctly, whereas splitting would produce two disconnected straight-line stubs with no great-circle curvature — arguably worse behavior. This is a known limitation; open for maintainer discussion if a MultiLineString split is preferred.
        if (npoints <= 2) {
            const arc = new Arc(this.properties);
            const line = new _LineString();
            arc.geometries.push(line);
            line.move_to(roundCoords([this.start.lon, this.start.lat]));
            line.move_to(roundCoords([this.end.lon, this.end.lat]));
            return arc;
        }
        // NOTE: options.offset was previously used as dfDateLineOffset in the GDAL-ported heuristic. It is kept in ArcOptions for backwards compatibility but is a no-op here.
        // Sample npoints evenly spaced positions along the great circle arc.
        const delta = 1.0 / (npoints - 1);
        const first_pass = [];
        for (let i = 0; i < npoints; ++i) {
            first_pass.push(this.interpolate(delta * i));
        }
        // Walk the sampled points, splitting into segments wherever the arc crosses the antimeridian.
        const segments = [];
        let current = [];
        for (let i = 0; i < first_pass.length; i++) {
            const pt = first_pass[i];
            if (i === 0) {
                current.push(pt);
                continue;
            }
            const prev = first_pass[i - 1];
            // A longitude jump > 180° between adjacent samples indicates an antimeridian crossing.
            if (Math.abs(pt[0] - prev[0]) > 180) {
                // Bisect to find the interpolation fraction f* at which the arc crosses ±180°.
                let lo = delta * (i - 1);
                let hi = delta * i;
                for (let iter = 0; iter < ANTIMERIDIAN_BISECTION_ITERATIONS; iter++) {
                    const mid = (lo + hi) / 2;
                    const [midLon] = this.interpolate(mid);
                    const [loLon] = this.interpolate(lo);
                    // If mid and lo are on the same side of ±180°, the crossing is in [mid, hi].
                    if (Math.abs(midLon - loLon) < 180) {
                        lo = mid;
                    }
                    else {
                        hi = mid;
                    }
                }
                // Compute the latitude at the crossing point and close/open segments at ±180°.
                const [, crossingLat] = this.interpolate((lo + hi) / 2);
                const fromEast = prev[0] > 0;
                current.push([fromEast ? 180 : -180, crossingLat]);
                segments.push(current);
                current = [[fromEast ? -180 : 180, crossingLat]];
            }
            current.push(pt);
        }
        if (current.length > 0) {
            segments.push(current);
        }
        // Build one LineString per segment and collect them into an Arc.
        const arc = new Arc(this.properties);
        for (const seg of segments) {
            const line = new _LineString();
            arc.geometries.push(line);
            for (const pt of seg) {
                line.move_to(roundCoords([pt[0], pt[1]]));
            }
        }
        return arc;
    }
}

window.arc={GreatCircle:GreatCircle,Arc:Arc,Coord:Coord};
})();