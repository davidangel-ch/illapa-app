export const MAX_LOGGED_ID_CHARS = 64;
export const HTTP_STATUS_CREATED = 201;
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_FORBIDDEN = 403;
export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_BAD_GATEWAY = 502;

export const MIN_FLEET_TEXT_LENGTH_CHARS = 1;
export const SINGLE_RESULT_LIMIT_ROWS = 1;
export const CONNECTION_STATUS_ACTIVE = "active";
export const CONNECTION_STATUS_ERROR = "error";
export const TRIP_STATUS_PLANNED = "planned";
export const TRIP_STATUS_ACTIVE = "active";
export const TRIP_STATUS_CANCELLED = "cancelled";
export const TRIP_STATUS_COMPLETED = "completed";
export const ALERT_STATUS_OPEN = "open";
export const ALERT_STATUS_ACKNOWLEDGED = "acknowledged";
export const CONNECTION_NOT_FOUND_MESSAGE = "No encontramos esa conexión GPS.";
export const CREDENTIALS_VALIDATION_FAILED_MESSAGE =
	"No pudimos validar las credenciales GPS. Revisa los datos y los permisos de acceso del proveedor.";
export const VEHICLE_IMPORT_FAILED_MESSAGE =
	"La conexión GPS se guardó, pero no pudimos importar sus vehículos. Revisa el acceso del proveedor e inténtalo de nuevo.";
export const VEHICLE_POSITION_REQUIRED_MESSAGE =
	"Elige un vehículo de tu organización que ya tenga una posición GPS antes de crear el viaje.";
export const ROUTING_FAILED_MESSAGE =
	"No pudimos calcular una ruta por carretera hasta este destino. Revisa el destino e inténtalo de nuevo.";
export const DEMO_VEHICLE_REQUIRED_MESSAGE =
	"Las rutas demo solo están disponibles para camiones de una flota demo con posición GPS.";
export const DEMO_HAZARD_ROUTE_NOT_FOUND_MESSAGE =
	"No encontramos un incidente activo en carretera cerca de este camión. Prueba con otro camión o marca el destino en el mapa.";
export const DEMO_CLEAR_ROUTE_NOT_FOUND_MESSAGE =
	"No encontramos una ruta sin incidentes cerca de este camión. Prueba con otro camión o marca el destino en el mapa.";
export const TRIP_NOT_ACTIVE_MESSAGE =
	"Solo se pueden cancelar o completar viajes activos.";
export const SAME_ORIGIN_AND_DESTINATION_MESSAGE =
	"Elige un destino distinto del origen.";
export const ROUTE_REVIEW_DEPARTURE_INVALID_MESSAGE =
	"Elige una salida desde ahora y dentro de las próximas 24 horas.";
export {
	ROUTE_CANDIDATE_NOT_FOUND_MESSAGE,
	ROUTE_REVIEW_NOT_FOUND_MESSAGE,
	TRIP_NOT_FOUND_MESSAGE,
	TRIP_NOT_PLANNED_MESSAGE,
	VEHICLE_GPS_REQUIRED_MESSAGE,
	VEHICLE_NOT_FOUND_MESSAGE,
	VEHICLE_PROFILE_REQUIRED_MESSAGE,
	VEHICLE_TRIP_ALREADY_ACTIVE_MESSAGE,
} from "@hack-the-andes-project/business/fleet/constants";
export const ALERT_NOT_FOUND_MESSAGE = "No encontramos esa alerta.";
export const ALERT_NOT_OPEN_MESSAGE =
	"Solo se pueden confirmar alertas abiertas.";

export const DEFAULT_INCIDENT_LIMIT_ROWS = 500;
export const MAX_INCIDENT_LIMIT_ROWS = 2000;
export const DEFAULT_NEWS_LIMIT_ROWS = 50;
export const MAX_NEWS_LIMIT_ROWS = 200;
export const DEFAULT_NEWS_RELEVANT_ONLY = true;
export const SCRAPER_ACTIVE = true;

export const MIN_LATITUDE_DEG = -90;
export const MAX_LATITUDE_DEG = 90;
export const MIN_LONGITUDE_DEG = -180;
export const MAX_LONGITUDE_DEG = 180;
export const INVALID_BOUNDING_BOX_MESSAGE =
	"Bounding box must have west <= east and south <= north.";

// Procedures reachable without a session. The server's global auth guard lets
// these through, and the web batch link keeps them out of batches so a public
// call never rides inside a guarded `/rpc/__batch__` request.
export const PUBLIC_PROCEDURE_PATHS: ReadonlySet<string> = new Set([
	"healthCheck",
]);

export const DEMO_CONNECTION_CREATE_FORBIDDEN_MESSAGE =
	"La cuenta demo solo permite conexiones demo.";
export const DEMO_CONNECTION_REMOVE_FORBIDDEN_MESSAGE =
	"La cuenta demo no permite eliminar conexiones.";
export const DEMO_PREPARE_FORBIDDEN_MESSAGE =
	"Esta acción solo está disponible para la cuenta demo.";
export const ROUTE_NOTE_MEMORY_TIMEOUT_MS = 4000;
export const MAX_ROUTE_NOTE_LENGTH_CHARS = 280;
export const ROUTE_NOTE_MEMORY_OFF_MESSAGE =
	"Las notas de ruta no están activadas en este servidor.";
export const ROUTE_NOTE_NOT_SAVED_MESSAGE =
	"No pudimos confirmar que Atomic Memory guardó la nota. Vuelve a cargar la página para comprobarla antes de guardarla otra vez.";
export const ROUTE_NOTE_NOT_REMOVED_MESSAGE =
	"No pudimos confirmar que Atomic Memory borró la nota. Vuelve a cargar la página para comprobarla.";
export const DEFAULT_RISK_HORIZON_HOURS = 24;
export const DEFAULT_RISK_SEGMENT_LIMIT_ROWS = 2000;
export const MAX_RISK_SEGMENT_LIMIT_ROWS = 10_000;
export const RISK_DISCLAIMER_MESSAGE =
	"Índice heurístico relativo de apoyo a decisiones, no una probabilidad calibrada. Contrasta siempre con las alertas oficiales de SENAMHI, INDECI y SUTRAN y revisa la fecha de cada evaluación.";
