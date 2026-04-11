-- Índice HNSW para búsqueda vectorial rápida de descriptores faciales
-- Con 5000+ descriptores, el sequential scan es lento. HNSW acelera la búsqueda L2.
CREATE INDEX IF NOT EXISTS idx_face_descriptors_vector_hnsw
ON client_face_descriptors
USING hnsw (descriptor vector_l2_ops)
WITH (m = 16, ef_construction = 64);
