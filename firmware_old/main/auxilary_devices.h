#include <stdio.h>
#include <time.h>
#include <unit.h>

#define			MAX_NUMBER_OF_ALARMS				40				//7 week days + 33 off days

#define 		AUXILARY_PERIOD						10				//in seconds
#define 		TIMEKEEPER_PERIOD					120				//in mins
#define 		OD_event_time_MASK					0x0FFFFFFF
#define 		OD_event_set_MASK					0xF0000000
#define 		OD_event_set_KEY					0xA0000000
#define 		OD_event_max_time					44739242		//max number of minutes in POSIX-TIME
//---
#define 		WD_event_min_MASK					0x000000FF
#define 		WD_event_hour_MASK					0x0000FF00
#define 		WD_event_wday_MASK					0x00FF0000
#define 		WD_event_set_MASK					0xFF000000
#define 		WD_event_set_KEY					0xAA000000

typedef struct {
	uint32_t	on_events[MAX_NUMBER_OF_ALARMS];
	uint32_t	off_events[MAX_NUMBER_OF_ALARMS];	
} events_internal_t;
typedef union {
	events_internal_t	events;
	uint8_t				raw_data[8*MAX_NUMBER_OF_ALARMS];
} events_t;
//---
typedef union {
	uint32_t	ui32Data[4];
	uint8_t		ui8Data[16];		
} flash_block_t;

//---
/*
esp_err_t		init_aux_functions(void);
esp_err_t		RTC_get_time(time_t * prawtime);
esp_err_t		RTC_set_time(time_t rawtime);
esp_err_t		WD_event_set_energy_saving(const uint8_t wkday, const uint8_t on_hour, const uint8_t on_min, const uint8_t off_hour, const uint8_t off_min);
esp_err_t		OD_event_set_energy_saving(const uint8_t position, const uint32_t on_time, const uint32_t off_time);
esp_err_t		WD_event_set_sterilization(const uint8_t wkday, const uint8_t on_hour, const uint8_t on_min);
esp_err_t		OD_event_set_sterilization(const uint8_t position, const uint32_t on_time);
uint32_t		Get_OD_event_energy_saving(const uint8_t i, uint32_t * on_time, uint32_t * off_time);
uint32_t		Get_WD_event_energy_saving(const uint8_t wday, uint32_t * on_hour, uint32_t * on_min, uint32_t * off_hour, uint32_t * off_min);
void			reset_RAM_energy_saving_data(void);
void			reset_RAM_sterilization_data(void);
esp_err_t		save_RAM_data(void);
esp_err_t		load_RAM_data(void);
esp_err_t		init_aux_functions(void);
uint32_t		Get_WD_event_sterilization(const uint8_t wday, uint32_t * on_hour, uint32_t * on_min);
uint32_t		Get_OD_event_sterilization(const uint8_t i, uint32_t * on_time);
esp_err_t		WD_event_set_sterilization_period(const uint32_t	period);
esp_err_t		Get_sterilization_event_period(uint32_t * period);
*/
//---
esp_err_t		save_RAM_data(void); 
esp_err_t		load_RAM_data(void);  
esp_err_t		init_aux_functions(void);
void			reset_RAM_energy_saving_data(void);
uint32_t		Get_OD_event_energy_saving(const uint8_t i, uint32_t * on_time, uint32_t * off_time);
uint32_t		Get_WD_event_energy_saving(const uint8_t wday, uint32_t * on_hour, uint32_t * on_min, uint32_t * off_hour, uint32_t * off_min);
esp_err_t		WD_event_set_energy_saving(const uint8_t wkday, const uint8_t on_hour, const uint8_t on_min, const uint8_t off_hour, const uint8_t off_min);
esp_err_t		OD_event_set_energy_saving(const uint8_t position, const uint32_t on_time, const uint32_t off_time);
esp_err_t		RTC_get_time(time_t * prawtime);
esp_err_t		RTC_set_time(pUNIT pUnit, time_t rawtime);
esp_err_t 		RTC_tick(void);
esp_err_t		save_to_NVS(pUNIT pUnit);
esp_err_t 		load_default_parameters(pUNIT pUnit);
esp_err_t		init_aux_functions(void);
esp_err_t		RTC_set_register(uint8_t addr, uint8_t data);
//---
