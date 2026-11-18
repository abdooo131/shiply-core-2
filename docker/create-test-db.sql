-- A second database for automated tests, so tests never touch development data.
CREATE DATABASE shiply_test OWNER shiply;

-- The image installs PostGIS and three add-ons into the main database. The
-- Prisma migrations install PostGIS themselves, so remove all of them here;
-- otherwise Prisma reports them as schema drift.
\connect shiply
DROP EXTENSION IF EXISTS postgis_tiger_geocoder, postgis_topology, fuzzystrmatch, postgis;
