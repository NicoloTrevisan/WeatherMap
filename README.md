# Cycling Route Planner

Available at: [https://nicolotrevisan.github.io/WeatherMap/](https://nicolotrevisan.github.io/WeatherMap/)

A web-based application that helps cyclists plan routes by generating optimal cycling paths, analyzing weather conditions along the route, and providing route data via GPX files.

## Overview

Cycling Route Planner is a responsive web app that leverages interactive mapping and third-party APIs to generate cycling routes. Users can:
- Create a route by specifying a start and end address.
- Generate a random loop route around a location with a set distance.
- Upload or download GPX files for route sharing.
- View integrated weather forecasts (temperature, wind speed/direction, precipitation) at various route segments.
- Calculate a “tailwind score” to assess how favorable the cycling conditions are.

## Features

- **Route Generation:** 
  - Input start and end addresses to generate a route.
  - Generate random loop routes with adjustable total distance.
- **Weather Integration:** 
  - Fetch weather forecasts from OpenWeatherMap for key points along the route.
  - Display weather details such as temperature, wind conditions, and precipitation.
- **Tailwind Analysis:** 
  - Compute a tailwind score to provide insights into route conditions.
- **GPX Support:** 
  - Upload an existing GPX file to visualize a route.
  - Save the generated route as a GPX file.
- **Responsive Design:** 
  - Optimized for both desktop and mobile layouts.
  - Toggleable sidebar for map controls and settings.

## Technologies Used

- **HTML/CSS/JavaScript:** Core web technologies for structure, styling, and functionality.
- **Leaflet:** For interactive map rendering.
- **GraphHopper API:** To generate cycling routes.
- **OpenWeatherMap API:** To retrieve weather forecasts.
- **Font Awesome:** For icons used throughout the interface.
