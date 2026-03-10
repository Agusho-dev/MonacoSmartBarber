CREATE OR REPLACE FUNCTION public.match_staff_face_descriptor(
  query_descriptor vector,
  match_threshold double precision DEFAULT 0.5,
  max_results integer DEFAULT 3
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_phone text,
  face_photo_url text,
  distance double precision
)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (s.id)
    s.id AS client_id,
    s.full_name AS client_name,
    COALESCE(s.phone, '') AS client_phone,
    NULL::text AS face_photo_url,
    (sfd.descriptor <-> query_descriptor)::FLOAT as distance
  FROM staff_face_descriptors sfd
  JOIN staff s ON s.id = sfd.staff_id
  WHERE (sfd.descriptor <-> query_descriptor) < match_threshold
  ORDER BY s.id, (sfd.descriptor <-> query_descriptor)
  LIMIT max_results;
END;
$function$;
