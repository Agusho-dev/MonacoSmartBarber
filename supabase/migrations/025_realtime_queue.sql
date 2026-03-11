-- Enable real-time for queue_entries
ALTER PUBLICATION supabase_realtime ADD TABLE queue_entries;

-- Enable real-time for break_requests
ALTER PUBLICATION supabase_realtime ADD TABLE break_requests;
