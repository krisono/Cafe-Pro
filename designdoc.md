## Project Overview
This project called Cafe-Pro is an inventory management system designed to help small cafes manage waste and improve inventory visibility. THis allows for the cafe to have a dashboard for all of the inventory and track it better. The main flow allows users to create inventory records, view current inventory, update inventory easily and search for items quickly.

## Tech Stack
-  Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Database/Storage: SQLite
- AI Integration: OpenAI API

## Design
- I went with a simple archetechture and used one server handling both the frontend and backend to keep the project lightweight and easier to manage.
- It uses a simple batch system that rotates the items to make sure theres not too much waste. it removed the old batches first.
- The openai service generates lightweight inventory recommendations. 
- I also made sure to have a rigid fallback service incase the AI is unavailable
- It tracks expiration well and it indictaes when it was done by a human
- This project also uses synthetic inventory data only instead of rea life events
- SQLite stores the inventory records and delivery batches because it is lightweight and easy to set up

## Future Enhancements
 - a better looking dashboard to see trends
 - low-stock and expiration alerts
 - Waste cost calculator
 - better authentication
 - more analytics and forecasting modells to predict future trends, what to buy etc
 - themed front end design thats user friendy
 - image scan for deliveries
