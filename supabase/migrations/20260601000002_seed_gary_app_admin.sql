-- Gary Grewal: workspace App Admin

UPDATE profiles
SET role = 'app_admin'
WHERE lower(email) = lower('gary.grewal@uhn.ca');
