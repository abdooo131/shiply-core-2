-- A second database for automated tests, so tests never touch development data.
CREATE DATABASE shiply_test OWNER shiply;
\connect shiply
CREATE EXTENSION IF NOT EXISTS postgis;
\connect shiply_test
CREATE EXTENSION IF NOT EXISTS postgis;
