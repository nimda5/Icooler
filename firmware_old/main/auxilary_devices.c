#include <stdio.h>
#include <esp_log.h>
#include <driver/i2c.h>
#include <main.h>
#include <auxilary_devices.h>
#include <time.h>
#include <unit.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"
//---
#define		RTC_SECONDS_ADDR			0x81
#define		RTC_MINUTES_ADDR			0x83
#define		RTC_HOURS_ADDR				0x85
#define		RTC_DATE_ADDR				0x87
#define		RTC_MONTH_ADDR				0x89
#define		RTC_WDAY_ADDR				0x8B
#define		RTC_YEAR_ADDR				0x8D
#define		RTC_CONTROL_ADDR			0x8F
#define		RTC_BACKUP_CHARGE_CNTRL		0x91
#define		RTC_RAM_START_ADDR			0xC0
#define 	RTC_STATE_ID_ADDR			0xC1
#define		RTC_RAM_END_ADDR			0xFD
#define		RTC_BACKUP_CHARGER_CONFIG	0xA5
#define		RTC_HAVE_BEEN_LOADED		0xA5
//---
#define		RTC_STRUCT_SEC				0
#define		RTC_STRUCT_SECTEN_MASK		0x70
#define		RTC_STRUCT_SECTEN_OFFSET	4
#define		RTC_STRUCT_SECONE_MASK		0x0F
//
#define		RTC_STRUCT_MIN				1
#define		RTC_STRUCT_MINTEN_MASK		0x70
#define		RTC_STRUCT_MINTEN_OFFSET	4
#define		RTC_STRUCT_MINONE_MASK		0x0F
//
#define		RTC_STRUCT_HOUR				2
#define		RTC_STRUCT_HOURTEN_MASK		0x30
#define		RTC_STRUCT_HOURTEN_OFFSET	4
#define		RTC_STRUCT_HOURONE_MASK		0x0F
//
#define		RTC_STRUCT_WDAY				3
#define 	RTC_STRUCT_WKDAY_MASK		0x07
//
#define		RTC_STRUCT_DATETEN_MASK		0x30
#define		RTC_STRUCT_DATE				4
#define		RTC_STRUCT_DATETEN_OFFSET	4
#define		RTC_STRUCT_DATEONE_MASK		0x0F
//
#define		RTC_STRUCT_MONTH			5
#define		RTC_STRUCT_MTHTEN_MASK		0x10
#define		RTC_STRUCT_MTHTEN_OFFSET	4
#define		RTC_STRUCT_MTHONE_MASK		0x0F
//
#define		RTC_STRUCT_YEAR				6
#define		RTC_STRUCT_YEARTEN_MASK		0xF0
#define		RTC_STRUCT_YEARTEN_OFFSET	4
#define		RTC_STRUCT_YEARONE_MASK		0x0F

//---

extern tUNIT    SIG_unit;
static events_t energy_saving;
nvs_handle_t 	NVS_handle;
// so, what i have to do now
esp_err_t		restore_from_NVS(pUNIT pUnit);
void 			auxilary_task(void * arg);
//---
void reset_RAM_energy_saving_data(void)
{	
	uint32_t	ui32Temp;	
	for (ui32Temp = 0; ui32Temp < MAX_NUMBER_OF_ALARMS; ui32Temp++)
	{
		energy_saving.events.on_events[ui32Temp] = 0;
		energy_saving.events.off_events[ui32Temp] = 0;
	}
}
//---
esp_err_t	load_RAM_data(void){
	return restore_from_NVS(&SIG_unit);
}
//---
esp_err_t	save_RAM_data(void) {	 
	return  save_to_NVS(&SIG_unit);
}
//---
esp_err_t		RTC_set_register(uint8_t addr, uint8_t data) {
	// 	
	// ok so basing on this
	uint8_t i = 0;
	//---	
	gpio_set_direction(GPIO_NUM_6, GPIO_MODE_OUTPUT);
	gpio_set_level(GPIO_NUM_7,0);	//SCLK
	esp_rom_delay_us(1);
	//delay
	gpio_set_level(GPIO_NUM_10,1);	//CE
	esp_rom_delay_us(1);	
	for (i = 0; i < 8; i++)	{
		esp_rom_delay_us(1);		
		gpio_set_level(GPIO_NUM_7,0);	//sclk low
		if ((addr & (1 << i)) != 0) {
			gpio_set_level(GPIO_NUM_6,1);	//
		} else {
			gpio_set_level(GPIO_NUM_6,0);	//
		}
		esp_rom_delay_us(1);	
		gpio_set_level(GPIO_NUM_7,1);	//sclk high
		//delay
	}	
	//---
	for (i = 0; i < 8; i++)	{
		esp_rom_delay_us(1);
		gpio_set_level(GPIO_NUM_7,0);	//sclk low
		if ((data & (1 << i)) != 0) {
			gpio_set_level(GPIO_NUM_6,1);	//
		} else {
			gpio_set_level(GPIO_NUM_6,0);	//
		}
		esp_rom_delay_us(1);
		gpio_set_level(GPIO_NUM_7,1);	//sclk high
		//delay
	}
	//---
	esp_rom_delay_us(1);
	gpio_set_level(GPIO_NUM_7,0);	//sclk high	
	esp_rom_delay_us(1);
	gpio_set_level(GPIO_NUM_10,0);	//CE low
	esp_rom_delay_us(1);	
	return ESP_OK;
}
//---
esp_err_t		RTC_read_register(uint8_t addr, uint8_t * rxed_data) {
	// 	
	// ok so basing on this
	// 1st update CE
	uint8_t data = 0;
	uint8_t i = 0;
	gpio_set_direction(GPIO_NUM_6, GPIO_MODE_OUTPUT);	
	gpio_set_level(GPIO_NUM_7,0);	//SCLK
	esp_rom_delay_us(1);
	//delay
	gpio_set_level(GPIO_NUM_10,1);	//CE
	esp_rom_delay_us(1);	
	for (i = 0; i < 8; i++)	{
		esp_rom_delay_us(1);	
		gpio_set_level(GPIO_NUM_7,0);	//sclk low		
		if ((addr & (1 << i)) != 0) {
			gpio_set_level(GPIO_NUM_6,1);	//
		} else {
			gpio_set_level(GPIO_NUM_6,0);	//
		}
		esp_rom_delay_us(1);	
		gpio_set_level(GPIO_NUM_7,1);	//sclk high
		//delay
	}		
	//---
	esp_rom_delay_us(1);	
	gpio_set_direction(GPIO_NUM_6, GPIO_MODE_INPUT);
	esp_rom_delay_us(1);
	gpio_set_level(GPIO_NUM_7,0);	//sclk high
	esp_rom_delay_us(1);
	//---
	// here need to switch GPIO_NUM_6 to the input mode	
	for (i = 0; i < 8; i++)	{		
		
		//
		if (gpio_get_level(GPIO_NUM_6) == 1)	{
			data |= (1 << i);
		}		
		gpio_set_level(GPIO_NUM_7,1);	//sclk low
		esp_rom_delay_us(1);				
		gpio_set_level(GPIO_NUM_7,0);	//sclk high
		esp_rom_delay_us(1);	
	}
	//---
	gpio_set_level(GPIO_NUM_7,0);	//sclk high
	esp_rom_delay_us(1);	
	gpio_set_level(GPIO_NUM_10,0);	//CE low
	esp_rom_delay_us(1);
	//--- return data
	*rxed_data = data;
	//--- return data	
	return ESP_OK;
}
//---
esp_err_t		save_to_NVS(pUNIT pUnit)
{	
	esp_err_t err = ESP_OK;
	uint32_t i = 0;	
	uint32_t ui32Temp = (pUnit->system.ui32PIN1 << 16) | (pUnit->system.ui32PIN2);
	//---
	err = nvs_set_u32(NVS_handle, "id", pUnit->ui32ID);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving ID");
		return err;
	}
	//---
	err = nvs_set_u32(NVS_handle, "pins", ui32Temp);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving PINs");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "res_time", pUnit->system.ui32Filter_resource_Days);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving res_time");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "res_vol", pUnit->system.ui32Filter_resource_L);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving res_vol");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "res_nwu", pUnit->system.ui32Filter_resource_NWU_Days);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving res_nwu");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "cur_vol", pUnit->system.ui32FILTER_used_L);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving cur_vol");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "cur_time", pUnit->system.ui32FILTER_used_H);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving cur_time");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "cur_nwu", pUnit->system.ui32FILTER_used_NWU_H);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving cur_nwu");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "cur_euvcoff", pUnit->system.ui32EUVC_off_reload);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving EUVC off time");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "cur_euvcon", pUnit->system.ui32EUVC_on_reload);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving EUVC on time");
		return err;	
	}
	//---
	err = nvs_set_u32(NVS_handle, "bot_volume", pUnit->system.ui32BOT_VOLUME);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving bottle volume");
		return err;	
	}	
	//--- ui32LASTBSWAP
	err = nvs_set_u32(NVS_handle, "last_bswap", pUnit->system.ui32LASTBSWAP);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving last bottle swap");
		return err;	
	}	
	//---
	err = nvs_set_u32(NVS_handle, "cons_total", pUnit->system.ui32CONSUMPTION_total_L);
	if	(err != ESP_OK) 
	{
		ESP_LOGE("NVS>", "Error saving consumption total");
		return err;	
	} else {
		pUnit->system.ui32CONSUMPTION_SAVED = pUnit->system.ui32CONSUMPTION_total_L;
		pUnit->system.ui32WATER_consumption_L = 0;
		UNIT_reset_WCS();
	}		
	//---	
	err = nvs_set_u32(NVS_handle, "cntrl_bits", (pUnit->system.ui32SYSTEM_state & HW_STATE_NV_MASK));
	if	(err != ESP_OK) 
	{
		ESP_LOGE("NVS>", "Error saving control bits");
		return err;	
	}	
	//---
	err = nvs_set_i64(NVS_handle, "cur_rst", pUnit->system.ui32FILTER_reset_POSIX_time);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving rst_time");
		return err;	
	}	
	//---
	//--- may be worth to renew this time here?

	err = nvs_set_i64(NVS_handle, "sys_time", pUnit->timeSystem_time);
	//!!!!
	RTC_set_time(pUnit, pUnit->timeSystem_time);
	//!!!!
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error saving system time");
		return err;	
	}	
	//---
	// here must add shceduller readings
	for (i = 0; i < MAX_NUMBER_OF_ALARMS; i++)
	{
		char key[32];
		snprintf(key, sizeof(key), "sch_on%lu", i);
		err = nvs_set_u32(NVS_handle, key, energy_saving.events.on_events[i]);	
		if (err != ESP_OK)
		{
			ESP_LOGE("NVS>", "Error saving sch_on");
			return err;	
		}
		snprintf(key, sizeof(key), "sch_off%lu", i);
		err = nvs_set_u32(NVS_handle, key, energy_saving.events.off_events[i]);
		if (err != ESP_OK)
		{
			ESP_LOGE("NVS>", "Error saving sch_off");
			return err;	
		}
	}

	return err;
}
//---
esp_err_t		restore_from_NVS(pUNIT pUnit){
	esp_err_t 	err = ESP_OK;	
	uint32_t 	ui32Temp = 0, i = 0;

	// ok, here we a reading operation for the same registers
	// operation - if at least one of the keys is missing - should load default values and save registers
	err = nvs_get_u32(NVS_handle, "id", &pUnit->ui32ID);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error reading ID, setting default parameters");
		load_default_parameters(pUnit);
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "pins", &ui32Temp);
	if (err == ESP_OK)
	{
		pUnit->system.ui32PIN1 = (ui32Temp >> 16) & 0x0000FFFF;
		pUnit->system.ui32PIN2 = ui32Temp & 0x0000FFFF;		
		if ((pUnit->system.ui32PIN1 > 9999) && (pUnit->system.ui32PIN2 > 9999))
		{
			ESP_LOGE("NVS>", "Error reading PINs, setting default parameters");
			load_default_parameters(pUnit);
			return ESP_FAIL;
		}
	}
	else
	{
		ESP_LOGE("NVS>", "Error reading PINs, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "res_time", &pUnit->system.ui32Filter_resource_Days);
	if (err == ESP_OK)
	{
		if ((pUnit->system.ui32Filter_resource_Days > 2000) && (pUnit->system.ui32Filter_resource_Days != 65535))
		{
			ESP_LOGE("NVS>", "Error reading res_time, setting default parameters");
			load_default_parameters(pUnit);
			return ESP_FAIL;
		}		
	}
	else
	{
		ESP_LOGE("NVS>", "Error reading res_time, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "res_vol", &pUnit->system.ui32Filter_resource_L);
	if (err == ESP_OK)
	{
		if ((pUnit->system.ui32Filter_resource_L > 65535) || (pUnit->system.ui32Filter_resource_L < 1))
		{
			ESP_LOGE("NVS>", "Error reading res_vol, setting default parameters");
			load_default_parameters(pUnit);
			return ESP_FAIL;
		}		
	}
	else
	{
		ESP_LOGE("NVS>", "Error reading res_vol, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "res_nwu", &pUnit->system.ui32Filter_resource_NWU_Days);
	if (err == ESP_OK)
	{
		if ((pUnit->system.ui32Filter_resource_NWU_Days > 65535) || (pUnit->system.ui32Filter_resource_NWU_Days < 1))
		{
			ESP_LOGE("NVS>", "Error reading res_nwu, setting default parameters");
			load_default_parameters(pUnit);
			return ESP_FAIL;
		}		
	}
	else
	{
		ESP_LOGE("NVS>", "Error reading res_nwu, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "cur_vol", &pUnit->system.ui32FILTER_used_L);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error reading cur_vol, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}	
	//---
	err = nvs_get_u32(NVS_handle, "cur_time", &pUnit->system.ui32FILTER_used_H);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error reading cur_time, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "cur_nwu", &pUnit->system.ui32FILTER_used_NWU_H);
	if (err != ESP_OK)
	{
		ESP_LOGE("NVS>", "Error reading cur_nwu, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "cur_euvcon", &pUnit->system.ui32EUVC_on_reload);
	if ((err != ESP_OK)  || (pUnit->system.ui32EUVC_on_reload > 36000))	// max 1hr
	{
		ESP_LOGE("NVS>", "Error reading EUVC on time, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_u32(NVS_handle, "cur_euvcoff", &pUnit->system.ui32EUVC_off_reload);
	if ((err != ESP_OK) || (pUnit->system.ui32EUVC_off_reload > 864000)) //max 24h
	{
		ESP_LOGE("NVS>", "Error reading EUVC off time, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---	
	err = nvs_get_u32(NVS_handle, "bot_volume", &pUnit->system.ui32BOT_VOLUME);
	if ((err != ESP_OK) || (pUnit->system.ui32BOT_VOLUME > 25000))
	{
		ESP_LOGE("NVS>", "Error reading bottle volume");
		return err;	
	}	
	//---
	err = nvs_get_u32(NVS_handle, "last_bswap", &pUnit->system.ui32LASTBSWAP);
	if	(err != ESP_OK) 
	{
		ESP_LOGE("NVS>", "Error reading last bottle swap");
		return err;	
	}	
	//---
	err = nvs_get_u32(NVS_handle, "cons_total", &pUnit->system.ui32CONSUMPTION_SAVED);	
	if	(err != ESP_OK) 
	{
		ESP_LOGE("NVS>", "Error reading consumption total");
		return err;	
	}
	//--- system state readback
	// here we are readng to temp, reseting all bits to be saved out
	//
	ui32Temp = 0;
	err = nvs_get_u32(NVS_handle, "cntrl_bits", &ui32Temp);
	if	(err != ESP_OK) 
	{
		ESP_LOGE("NVS>", "Error reading control bits");
		return err;	
	}	
	pUnit->system.ui32SYSTEM_state &= ~HW_STATE_NV_MASK;
	pUnit->system.ui32SYSTEM_state |= (ui32Temp & HW_STATE_NV_MASK);

	// by the way good questions
	// this actually means, that any change(except )		
	//---
	err = nvs_get_i64(NVS_handle, "cur_rst", &pUnit->system.ui32FILTER_reset_POSIX_time);
	if ((err != ESP_OK) || (pUnit->system.ui32FILTER_reset_POSIX_time < AGE_START_POINT))
	{
		ESP_LOGE("NVS>", "Error reading rst_time, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	err = nvs_get_i64(NVS_handle, "sys_time", &pUnit->timeSystem_time);
	if ((err != ESP_OK) ||  (pUnit->timeSystem_time < AGE_START_POINT))
	{
		ESP_LOGE("NVS>", "Error reading sys_time, setting default parameters");
		load_default_parameters(pUnit);		
		return ESP_FAIL;
	}
	//---
	// here must add shceduller readings
	for (i = 0; i < MAX_NUMBER_OF_ALARMS; i++)
	{
		char key[32];
		snprintf(key, sizeof(key), "sch_on%lu", i);
		err = nvs_get_u32(NVS_handle, key, &energy_saving.events.on_events[i]);	
		if (err != ESP_OK) 
		{
			ESP_LOGE("NVS>", "Error reading sch_on, loading default parameters");
			load_default_parameters(pUnit);
			return err;	
		}
		snprintf(key, sizeof(key), "sch_off%lu", i);
		err = nvs_get_u32(NVS_handle, key, &energy_saving.events.off_events[i]);
		if (err != ESP_OK)
		{
			ESP_LOGE("NVS>", "Error reading sch_off, loading default parameters");
			load_default_parameters(pUnit);
			return err;	
		}
	}
	ESP_LOGI("NVS>", "Parameters restored from NVS");
	return ESP_OK;
}
//---
esp_err_t load_default_parameters(pUNIT pUnit)
{
	uint32_t	i = 0;
	//---	
	#if (defined(SS_PIPE_CHA) || defined(SS_PIPE_CHS)) 
	pUnit->system.ui32Filter_resource_Days = DEFAULT_FILTER_RESOURCE_DAYS;
	pUnit->system.ui32Filter_resource_L = DEFAULT_FILTER_RESOURCE_LITERS;
	pUnit->system.ui32Filter_resource_NWU_Days = DEFAULT_FILTER_NWU_DAYS;
	#else 
	// disable filter resources by default
	pUnit->system.ui32Filter_resource_Days = 65535;
	pUnit->system.ui32Filter_resource_L = 65535;
	pUnit->system.ui32Filter_resource_NWU_Days = 65535;
	#endif
	pUnit->system.ui32PIN1 = DEFAULT_PIN1;
	pUnit->system.ui32PIN2 = DEFAULT_PIN2;		
	pUnit->system.ui32FILTER_used_L = 0;
	pUnit->system.ui32WATER_consumption_L = 0;
	pUnit->system.ui32CONSUMPTION_total_L = 0;
	pUnit->system.ui32FILTER_used_H = 0;
	pUnit->system.ui32FILTER_used_NWU_H = 0;
	pUnit->system.ui32FILTER_reset_POSIX_time = AGE_START_POINT;
	pUnit->timeSystem_time = AGE_START_POINT;
	pUnit->system.ui32LASTBSWAP = AGE_START_POINT;
	pUnit->system.ui32EUVC_on_reload = EUVC_on_default;		
	pUnit->system.ui32EUVC_off_reload = EUVC_off_default;	
	pUnit->system.ui32BOT_VOLUME = 18900;
	pUnit->ui32ID = DEFAULT_ID;
	//---
	//
	for(i=0; i < MAX_NUMBER_OF_ALARMS; i++)
	{
		energy_saving.events.on_events[i] = 0;
		energy_saving.events.off_events[i] = 0;
	}
	//---
	ESP_LOGI("NVS>", "Default parameters loaded");
	return save_to_NVS(pUnit);
};
//---
static struct tm	Parse_RTC_datetime_to_C_datetime(uint8_t ui8RTCDATA[])
{
	struct tm	timeTemp;
	uint8_t		wkday;
	// here need to fix leap year, number of 
	// here +100 because coversion is since 1900
	timeTemp.tm_year = 100+10*((ui8RTCDATA[RTC_STRUCT_YEAR] & RTC_STRUCT_YEARTEN_MASK) >> RTC_STRUCT_YEARTEN_OFFSET) + (ui8RTCDATA[RTC_STRUCT_YEAR] & RTC_STRUCT_YEARONE_MASK);	
	timeTemp.tm_mon = 10*((ui8RTCDATA[RTC_STRUCT_MONTH] & RTC_STRUCT_MTHTEN_MASK) >> RTC_STRUCT_MTHTEN_OFFSET) + (ui8RTCDATA[RTC_STRUCT_MONTH] & RTC_STRUCT_MTHONE_MASK) - 1;
	timeTemp.tm_mday = 10*((ui8RTCDATA[RTC_STRUCT_DATE] & RTC_STRUCT_DATETEN_MASK) >> RTC_STRUCT_DATETEN_OFFSET) + (ui8RTCDATA[RTC_STRUCT_DATE] & RTC_STRUCT_DATEONE_MASK);
	timeTemp.tm_hour = 10*((ui8RTCDATA[RTC_STRUCT_HOUR] & RTC_STRUCT_HOURTEN_MASK) >> RTC_STRUCT_HOURTEN_OFFSET) + (ui8RTCDATA[RTC_STRUCT_HOUR] & RTC_STRUCT_HOURONE_MASK);
	timeTemp.tm_min = 10*((ui8RTCDATA[RTC_STRUCT_MIN] & RTC_STRUCT_MINTEN_MASK) >> RTC_STRUCT_MINTEN_OFFSET) + (ui8RTCDATA[RTC_STRUCT_MIN] & RTC_STRUCT_MINONE_MASK);
	timeTemp.tm_sec = 10*((ui8RTCDATA[RTC_STRUCT_SEC] & RTC_STRUCT_SECTEN_MASK) >> RTC_STRUCT_SECTEN_OFFSET) + (ui8RTCDATA[RTC_STRUCT_SEC] & RTC_STRUCT_SECONE_MASK);
	wkday = ui8RTCDATA[RTC_STRUCT_WDAY] & RTC_STRUCT_WKDAY_MASK;
	timeTemp.tm_wday = (wkday == 7) ? 0 : wkday;
	timeTemp.tm_isdst = -1;
	return timeTemp;
}
//---
static esp_err_t	Parser_C_datetime_to_RTC_datetime(uint8_t * ui8RTCDATA, const struct tm timeTemp)	
{
	esp_err_t ret = ESP_OK;
	// ok, here getting data in tempTime and should parse it
	uint8_t		year = (uint8_t)timeTemp.tm_year - 100;
	uint8_t		month = (uint8_t)timeTemp.tm_mon + 1;
	uint8_t		date = (uint8_t)timeTemp.tm_mday;
	uint8_t		wkday = (timeTemp.tm_wday == 0 ?  (uint8_t)7 : (uint8_t)timeTemp.tm_wday);
	uint8_t		hour = timeTemp.tm_hour;
	uint8_t		min = timeTemp.tm_min;
	uint8_t		sec = timeTemp.tm_sec;
	//---
	ui8RTCDATA[RTC_STRUCT_YEAR] = (((year / 10) << RTC_STRUCT_YEARTEN_OFFSET) & RTC_STRUCT_YEARTEN_MASK) + ((year % 10) & RTC_STRUCT_YEARONE_MASK);
	ui8RTCDATA[RTC_STRUCT_MONTH] = 	(((month / 10) << RTC_STRUCT_MTHTEN_OFFSET) & RTC_STRUCT_MTHTEN_MASK) + ((month % 10) & RTC_STRUCT_MTHONE_MASK);
	ui8RTCDATA[RTC_STRUCT_DATE] = (((date / 10)  << RTC_STRUCT_DATETEN_OFFSET) & RTC_STRUCT_DATETEN_MASK) + ((date % 10) & RTC_STRUCT_DATEONE_MASK);
	ui8RTCDATA[RTC_STRUCT_WDAY] = (wkday & RTC_STRUCT_WKDAY_MASK);
	ui8RTCDATA[RTC_STRUCT_HOUR] = (((hour / 10) << RTC_STRUCT_HOURTEN_OFFSET) & RTC_STRUCT_HOURTEN_MASK) + ((hour % 10) & RTC_STRUCT_HOURONE_MASK);
	ui8RTCDATA[RTC_STRUCT_MIN] = (((min / 10)  << RTC_STRUCT_MINTEN_OFFSET) & RTC_STRUCT_MINTEN_MASK) + ((min % 10) & RTC_STRUCT_MINONE_MASK);
	ui8RTCDATA[RTC_STRUCT_SEC] = (((sec / 10)  << RTC_STRUCT_SECTEN_OFFSET) & RTC_STRUCT_SECTEN_MASK) + ((sec % 10) & RTC_STRUCT_SECONE_MASK);	
	return ret;
}
//---
esp_err_t RTC_tick(void) {
	SIG_unit.timeSystem_time++;
	return ESP_OK;
}
//---
esp_err_t RTC_get_time(time_t * prawtime)
{
	esp_err_t ret = ESP_OK;
	uint8_t		ui8RTCDATA[7];
	struct tm	timeTemp;
	uint8_t		i;
	time_t		ttTEMP;		
	//	
	ret = RTC_read_register(RTC_SECONDS_ADDR, &ui8RTCDATA[RTC_STRUCT_SEC]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_read_register(RTC_MINUTES_ADDR, &ui8RTCDATA[RTC_STRUCT_MIN]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_read_register(RTC_HOURS_ADDR, &ui8RTCDATA[RTC_STRUCT_HOUR]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_read_register(RTC_DATE_ADDR, &ui8RTCDATA[RTC_STRUCT_DATE]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_read_register(RTC_MONTH_ADDR, &ui8RTCDATA[RTC_STRUCT_MONTH]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_read_register(RTC_YEAR_ADDR, &ui8RTCDATA[RTC_STRUCT_YEAR]);	
	if (ret != ESP_OK) { return ret; }
	ret = RTC_read_register(RTC_WDAY_ADDR, &ui8RTCDATA[RTC_STRUCT_WDAY]);
	if (ret != ESP_OK) { return ret; }
	//data stored	
	ESP_LOGI("PARS_GET>", "RTC Time  - %u, %u, %u, %u, %u, %u, %u", ui8RTCDATA[RTC_STRUCT_YEAR], ui8RTCDATA[RTC_STRUCT_MONTH], 
		ui8RTCDATA[RTC_STRUCT_DATE], ui8RTCDATA[RTC_STRUCT_HOUR], ui8RTCDATA[RTC_STRUCT_MIN], 
		ui8RTCDATA[RTC_STRUCT_SEC], ui8RTCDATA[RTC_STRUCT_WDAY]);
	timeTemp = Parse_RTC_datetime_to_C_datetime(ui8RTCDATA);
	ESP_LOGI("PARS_GET>", "Time system - %u, %u, %u, %u, %u, %u, %u", timeTemp.tm_year, timeTemp.tm_mon, timeTemp.tm_mday, timeTemp.tm_hour, timeTemp.tm_min, timeTemp.tm_sec, timeTemp.tm_wday);
	ttTEMP = mktime(&timeTemp);
	ESP_LOGI("PARS_GET>", "Time system posix- %llu", ttTEMP);
	*prawtime = ttTEMP;//mktime(&timeTemp);	
	return ret;	
}
//---
esp_err_t RTC_set_time(pUNIT pUnit, time_t rawtime)		
{	
	esp_err_t ret = ESP_OK;
	struct tm timeTemp;// = *gmtime(&rawtime);
	uint8_t		ui8RTCDATA[7];		
	int32_t	i;
	//---	
	ret = RTC_set_register(RTC_SECONDS_ADDR-1, 0x80);
	if (ret != ESP_OK) { return ret; }	
	timeTemp = *gmtime(&rawtime);	
	pUnit->timeSystem_time = rawtime;		
	//---
	Parser_C_datetime_to_RTC_datetime(ui8RTCDATA, timeTemp);
	ESP_LOGI("TIME>", "Raw time system - %llu", rawtime);
	ESP_LOGI("TIME>", "Time system - %u, %u, %u, %u, %u, %u, %u",timeTemp.tm_year, timeTemp.tm_mon, timeTemp.tm_mday, timeTemp.tm_hour, timeTemp.tm_min, timeTemp.tm_sec, timeTemp.tm_wday);
	ESP_LOGI("TIME>", "RTC time - %u, %u, %u, %u, %u, %u, %u", ui8RTCDATA[6], ui8RTCDATA[5], ui8RTCDATA[4], ui8RTCDATA[2], ui8RTCDATA[1], ui8RTCDATA[0], ui8RTCDATA[3]);
	//---	
	ret = RTC_set_register(RTC_MINUTES_ADDR-1, ui8RTCDATA[RTC_STRUCT_MIN]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_set_register(RTC_HOURS_ADDR-1, ui8RTCDATA[RTC_STRUCT_HOUR]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_set_register(RTC_DATE_ADDR-1, ui8RTCDATA[RTC_STRUCT_DATE]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_set_register(RTC_MONTH_ADDR-1, ui8RTCDATA[RTC_STRUCT_MONTH]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_set_register(RTC_YEAR_ADDR-1, ui8RTCDATA[RTC_STRUCT_YEAR]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_set_register(RTC_WDAY_ADDR-1, ui8RTCDATA[RTC_STRUCT_WDAY]);
	if (ret != ESP_OK) { return ret; }
	ret = RTC_set_register(RTC_SECONDS_ADDR-1, ui8RTCDATA[RTC_STRUCT_SEC]); //second are set last, because writing to this registers also restarts clock
	if (ret != ESP_OK) { return ret; }
	//---
	ESP_LOGI("TIME>", "Clock started and set");
	//---			
	//if (save_to_NVS(pUnit) == ESP_OK) {
	//	ESP_LOGI("TIME>", "Raw time updated");	
	//}			
	//---
	return ret;	
}
//---

//---
esp_err_t		init_RTC_functions(void) {
	esp_err_t 	err;
	uint8_t		ui8TRC_tmp;
	time_t		current_time;
	//
	// ok, next question here is to initialize RTC
	// we are going to change the behavior here
	// backup control register going to be loaded with corresponding command
	// each time system starts up, but also 2 ram registers will be loaded one with 0xAA, second with 0x55

	err = RTC_set_register(RTC_CONTROL_ADDR-1, 0x00);
	if (err != ESP_OK) {
       	ESP_LOGE("RTC>", "Failed to disable write protection");
       	return ESP_FAIL;
    }
	//--
	err = RTC_set_register(RTC_BACKUP_CHARGE_CNTRL-1, RTC_BACKUP_CHARGER_CONFIG);
	if (err != ESP_OK) {
       	ESP_LOGE("RTC>", "Failed to configure backup");
       	return ESP_FAIL;
    }
	//---
	err = RTC_read_register(RTC_STATE_ID_ADDR, &ui8TRC_tmp);
	if (err != ESP_OK) {
        ESP_LOGE("RTC>", "Failed to read state id register");
        return ESP_FAIL;
    }
	//---
	ESP_LOGI("RTC>", "register value - %02X", ui8TRC_tmp);
	// next check if 
	if (ui8TRC_tmp != RTC_HAVE_BEEN_LOADED) {
		
		err = RTC_set_register(RTC_STATE_ID_ADDR-1, RTC_HAVE_BEEN_LOADED); //!!!
		if (err != ESP_OK) {
        	ESP_LOGE("RTC>", "Failed to set state id register");
        	return ESP_FAIL;
    	}
		//---		
		err = RTC_set_time(&SIG_unit, SIG_unit.timeSystem_time);
		if (err != ESP_OK) {
        	ESP_LOGE("RTC>", "Failed to set time");
        	return ESP_FAIL;
    	}		
		//---
	} else {
		err = RTC_get_time(&SIG_unit.timeSystem_time);

		if (err != ESP_OK) {
        	ESP_LOGE("RTC>", "Failed to get time");
        	return ESP_FAIL;
    	}
	}
	// value matches the one, we are going to use

	return err;
	// here checking if ui
}
//---
static uint32_t		validTime(const struct tm timeTemp) {
	uint32_t	ret = 1;
	if ((timeTemp.tm_sec > 59) || (timeTemp.tm_sec < 0)) { ret = 0; }
	if ((timeTemp.tm_min > 61) || (timeTemp.tm_min < 0)) { ret = 0; }
	if ((timeTemp.tm_hour > 23) || (timeTemp.tm_hour < 0)) { ret = 0; }
	if ((timeTemp.tm_mday > 31) || (timeTemp.tm_mday < 1)) { ret = 0; }
	if ((timeTemp.tm_wday > 6) || (timeTemp.tm_wday < 0)) { ret = 0; }
	if ((timeTemp.tm_year > 150) || (timeTemp.tm_year < 121)) { ret = 0; }
	return ret;
}
//---
esp_err_t		init_nvs_functions(void) {
// here need to init NVS functionality
	// Initialize NVS
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        // NVS partition was truncated and needs to be erased
        // Retry nvs_flash_init
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    // Open NVS handle
    ESP_LOGI("NVS>", "Opening Non-Volatile Storage (NVS) handle...");    
    err = nvs_open("storage", NVS_READWRITE, &NVS_handle);
    if (err != ESP_OK) {
        ESP_LOGE("NVS>", "Error (%s) opening NVS handle!", esp_err_to_name(err));
        return ESP_FAIL;
    }
	return ESP_OK;	
}
//---
esp_err_t		init_aux_functions(void)
{
	esp_err_t	err = ESP_OK;
	// --- here to init NVS
	err = init_nvs_functions();
	if (err != ESP_OK) {
		ESP_LOGE("NVS>", "Error initializing NVS functions");
		return err;
	}	
	// --- read data from NVS
	err = restore_from_NVS(&SIG_unit);
	if (err != ESP_OK) {
		ESP_LOGE("NVS>", "Error restoring data from NVS, loading default parameters loaded");
		restore_from_NVS(&SIG_unit);
	}
	//--- next 
	err = 	init_RTC_functions();
	if (err != ESP_OK) {
		ESP_LOGE("RTC>", "Error initializing RTC functions");
		return err;
	}
	//---
	xTaskCreate(auxilary_task, "auxilary_task", 2048, NULL, 10, NULL);
	return err;
}
//---
//---
static uint32_t		WD_event_matching(const struct tm currentTime, uint32_t	eventTime)
{
	uint32_t	ret = 1;
	int			hour = (eventTime & WD_event_hour_MASK) >> 8;
	int			min = (eventTime & WD_event_min_MASK);
	int			wday = (eventTime & WD_event_wday_MASK) >> 16;
	//---
	ESP_LOGI("EVENT_MATCH>", "current time - %02u:%02u, %u, eventTime - %02u:%02u, %u", currentTime.tm_hour, currentTime.tm_min, currentTime.tm_wday, hour, min, wday);
	//---
	if (currentTime.tm_hour != hour) 
	{
		ret = 0; 
	}
	if (currentTime.tm_min != min) 
	{
		ret = 0; 
	}
	if (currentTime.tm_wday != wday) 
	{
		ret = 0; 
	}
	//---
	ESP_LOGI("EVENT_MATCH>", "result -  %u", ret);
	//---
	return ret;
}
//---
static uint32_t		OD_event_matching(const time_t currentTime, const time_t	eventTime)
{
	time_t		currentTime_min = currentTime / 60;
	uint32_t	ret = 1;
	if ((eventTime & OD_event_time_MASK) != currentTime_min) { ret = 0; }
	return ret;
}
//---
esp_err_t			WD_event_set_energy_saving(const uint8_t	wkday, const uint8_t on_hour, const uint8_t on_min, const uint8_t off_hour, const uint8_t off_min)
{
	static esp_err_t	ret = ESP_OK;
	uint8_t	wday = (wkday == 7) ? 0 : wkday;
	//here check supplied data
	// wkday should be in range of 1-7, hour 00-23, minutes 00-59
	if (wday > 6) {return ESP_FAIL;}
	if ((on_hour > 23) || (off_hour > 23)) {return ESP_FAIL;}
	if ((on_min > 59) || (off_min > 59)) {return ESP_FAIL;}
	//---
	energy_saving.events.on_events[wday] = WD_event_set_KEY + (wday << 16) + (on_hour << 8) + on_min;
	energy_saving.events.off_events[wday] = WD_event_set_KEY + (wday << 16) + (off_hour << 8) + off_min;
	//---
	return ret;
}
esp_err_t			OD_event_set_energy_saving(const uint8_t position, const uint32_t on_time, const uint32_t off_time)
{
	static esp_err_t	ret = ESP_OK;
	if (position > 32) {return ESP_FAIL;}
	if ((on_time < AGE_START_POINT) || (off_time < AGE_START_POINT)) {return ESP_FAIL;}	
	//---
	energy_saving.events.on_events[7 + position] = OD_event_set_KEY + (on_time/60);
	energy_saving.events.off_events[7 + position] = OD_event_set_KEY + (off_time/60);
	//---	
	return ret;
}
//---
uint32_t		Get_WD_event_energy_saving(const uint8_t wday, uint32_t * on_hour, uint32_t * on_min, uint32_t * off_hour, uint32_t * off_min)
{
#ifdef SYS_DEBUG
	*on_hour = 22;
	*on_min = 00;
	*off_hour = 23;
	*off_min = 00;
	return 1;
#else	
	if ((energy_saving.events.on_events[wday] & WD_event_set_MASK) != WD_event_set_KEY)
	{
		return 0;
	}
	else
	{
		*on_hour = (energy_saving.events.on_events[wday] >> 8) & 0xFF;
		*on_min = (energy_saving.events.on_events[wday]) & 0xFF;
		*off_hour = (energy_saving.events.off_events[wday] >> 8) & 0xFF;
		*off_min = (energy_saving.events.off_events[wday]) & 0xFF;
	}
	return 1;
#endif	
	
}
//---
uint32_t		Get_OD_event_energy_saving(const uint8_t i, uint32_t * on_time, uint32_t * off_time)
{
#ifdef SYS_DEBUG
	*on_time = 1922911200;
	*off_time = 1922914800;		
	return 1;
#else		
	if ((energy_saving.events.on_events[i] & OD_event_set_MASK) != OD_event_set_KEY)
	{
		return 0;
	}
	else
	{
		*on_time = (energy_saving.events.on_events[i] & (~OD_event_set_MASK)) * 60;
		*off_time = (energy_saving.events.off_events[i] & (~OD_event_set_MASK)) * 60;		
	}
	return 1;
#endif	
}
//---
void auxilary_task(void * arg)
{
	static esp_err_t	err = ESP_OK;
	static time_t		posix_time = AGE_START_POINT;	
	static uint32_t		saving_timer = TIMEKEEPER_PERIOD;
	static uint8_t		min_last = 0;
	static struct tm	timeTemp;
	static uint32_t		unit_on_state = 2;	//here - 2 - undefined, 1 - unit_should_be set on, 0 - unit
	static uint32_t		steril_state = 0;
	static uint8_t		ui8TRC_tmp;
	for (;;)
	{
		vTaskDelay(AUXILARY_PERIOD * 1000 / portTICK_PERIOD_MS);	
		//---
		unit_on_state = 2;
		steril_state = 0;
		//---
		err = RTC_get_time(&posix_time);
		ESP_LOGI("AUX_TASK>", "Raw time - %llu, saving timer - %lu", posix_time, saving_timer);		
		ESP_LOGI("AUX_TASK>", "UVC timer - %lu", (SIG_unit.system.ui32EUVC_timer & 0x7FFFFFFF));		 
		if (err != ESP_OK)
		{
			//here rise error
		}
		if ((posix_time < AGE_START_POINT) || (posix_time == 0xFFFFFFFF))
		{
			//here error, should report???
		}
		SIG_unit.timeSystem_time = posix_time;		
		// so, first get this time, second validate it
		timeTemp = *gmtime(&posix_time);
		//next validate it
		if (validTime(timeTemp))
		{						
			if (min_last != timeTemp.tm_min)
			{
				//here minute changed
				min_last = timeTemp.tm_min;
				//---
				if ((energy_saving.events.on_events[timeTemp.tm_wday] & WD_event_set_MASK) == WD_event_set_KEY)
				{					
					if (WD_event_matching(timeTemp, energy_saving.events.on_events[timeTemp.tm_wday]))
					{
						ESP_LOGI("EVENT_MATCH>", "Setting on WD");		
						unit_on_state = 1;				
					}										
				}
				//---
				if ((energy_saving.events.off_events[timeTemp.tm_wday] & WD_event_set_MASK) == WD_event_set_KEY)
				{					
					if (WD_event_matching(timeTemp, energy_saving.events.off_events[timeTemp.tm_wday]))
					{
						unit_on_state = 0;	
						ESP_LOGI("EVENT_MATCH>", "Setting off WD");					
					}										
				}
				
				//---
				for (uint32_t i = 7; i < MAX_NUMBER_OF_ALARMS; i++)
				{					
					if ((energy_saving.events.on_events[i] & OD_event_set_MASK) == OD_event_set_KEY)
					{
						if (OD_event_matching(posix_time, energy_saving.events.on_events[i]))
						{
							unit_on_state = 1;
							
						}
					}
					//---
					if ((energy_saving.events.off_events[i] & OD_event_set_MASK) == OD_event_set_KEY)
					{
						if (OD_event_matching(posix_time, energy_saving.events.off_events[i]))
						{
							unit_on_state = 0;
						}
					}
					//---					
				}		
				//---								
				//if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_AUTO_ON)
				//{	
					if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_UNIT_ON)
					{
						if (unit_on_state == 0)
						{
							//unit is on, requested to be set off	
							SIG_unit.system.ui32SYSTEM_state &= ~HW_STATE_UNIT_ON;
							//							
							ESP_LOGI("SHDLR>", "Setting unit OFF");
							//if (UNIT_send_data(&SIG_unit) != Cloud_CMD_good)
							//{
							//	ESP_LOGE("SHDLR>", "Failed data sending to controller");
							//}							
						}
					}
					else
					{
						if (unit_on_state == 1)
						{
							//unit is off, requested to be set on
							SIG_unit.system.ui32SYSTEM_state |= HW_STATE_UNIT_ON;	
							//						
							ESP_LOGI("SHDLR>", "Setting unit ON");
							//if (UNIT_send_data(&SIG_unit) != Cloud_CMD_good)
							//{
							//	ESP_LOGE("SHDLR>", "Failed data sending to controller");
							//}						
						}
					}
				//}
				//---
				//saving process tick				
				if(saving_timer > 0)
				{
					saving_timer--;
				}
				else
				{
					// ok, here i am dealing with register, just saving time. Right now, it is being excuted one time per 15min.
					// i think 1 time per 120min or 2 hours could be good enought.					
					saving_timer = TIMEKEEPER_PERIOD;					
					// 
					//
					RTC_set_time(&SIG_unit, SIG_unit.timeSystem_time);					
					// ok, so what we are going
					err = save_to_NVS(&SIG_unit);
					if (err != ESP_OK)
					{
						ESP_LOGE("TIME>", "Failed to save timekeepr register, error code\n");
					}
				}				
				//---				
			}			
		}
		else
		{
			//time is invalide - what to do?
			// try again or just set last saved?
			// if occasional reading mistake?			
		}
		// in posix_time now, have actual RTC value		
	}	
	vTaskDelete(NULL);
}
