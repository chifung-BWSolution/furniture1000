-- bwf_quote.total_amount is the single source of truth for quote totals.
-- Remove duplicated project_data.grandTotal to avoid future drift/confusion.
UPDATE bwf_quote
SET project_data = project_data - 'grandTotal'
WHERE project_data ? 'grandTotal';
