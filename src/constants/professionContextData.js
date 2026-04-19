module.exports = {
  CONTEXT_PROFESSIONS: {
    wedding: ['Caterer', 'Pandit', 'Decorator', 'Mehendi Artist', 'Photographer', 'Videographer', 'Event Planner', 'Dhol Player'],
    marriage: ['Caterer', 'Pandit', 'Decorator', 'Mehendi Artist', 'Photographer', 'Videographer', 'Event Planner', 'Dhol Player'],
    shaadi: ['Caterer', 'Pandit', 'Decorator', 'Mehendi Artist', 'Photographer', 'Videographer', 'Event Planner', 'Dhol Player'],
    shadi: ['Caterer', 'Pandit', 'Decorator', 'Mehendi Artist', 'Photographer', 'Videographer', 'Event Planner', 'Dhol Player'],
    bridal: ['Beautician', 'Mehendi Artist', 'Photographer', 'Videographer', 'Designer'],
    beauty: ['Beautician', 'Barber', 'Hair Stylist', 'Mehendi Artist'],
    childcare: ['Home Tutor', 'Teacher', 'Cleaner', 'Consultant'],
    child: ['Home Tutor', 'Teacher', 'Cleaner', 'Consultant'],
    baby: ['Home Tutor', 'Teacher', 'Cleaner', 'Consultant'],
    home: ['Cleaner', 'Electrician', 'Plumber', 'Painter', 'Carpenter', 'AC Repair Technician'],
    repair: ['Electrician', 'Plumber', 'Carpenter', 'AC Repair Technician', 'Mobile Repair Technician', 'Auto Mechanic'],
    event: ['Event Planner', 'Decorator', 'Photographer', 'Videographer', 'Caterer'],
    religious: ['Pandit', 'Caterer', 'Decorator'],
    puja: ['Pandit', 'Caterer', 'Decorator']
  },
  PROFESSION_RELATIONS: {
    Caterer: ['Event Planner', 'Decorator', 'Pandit', 'Mehendi Artist', 'Photographer', 'Videographer', 'Dhol Player'],
    'Mehendi Artist': ['Beautician', 'Photographer', 'Videographer', 'Decorator', 'Event Planner'],
    Beautician: ['Mehendi Artist', 'Photographer', 'Videographer', 'Designer'],
    Photographer: ['Videographer', 'Decorator', 'Event Planner'],
    Videographer: ['Photographer', 'Decorator', 'Event Planner'],
    'Home Tutor': ['Teacher', 'Consultant'],
    Teacher: ['Home Tutor', 'Consultant'],
    Cleaner: ['House Cleaner', 'Housekeeper'],
    Electrician: ['Plumber', 'Carpenter', 'Painter', 'AC Repair Technician'],
    Plumber: ['Electrician', 'Carpenter', 'Painter'],
    Carpenter: ['Painter', 'Interior Designer', 'Builder'],
    'Event Planner': ['Decorator', 'Caterer', 'Photographer', 'Videographer', 'Pandit'],
    Decorator: ['Event Planner', 'Caterer', 'Photographer', 'Videographer'],
    Pandit: ['Caterer', 'Decorator', 'Event Planner'],
    Barber: ['Hair Stylist', 'Beautician'],
    'Hair Stylist': ['Barber', 'Beautician']
  }
};
