#include <freertos/FreeRTOS.h>
/*
 *
 GET lastbswap:x(x - Unix time)
 GET consumptiontotal:x, x in liters
 GET/POST hottank:x (0 - off, 1 - on)
 GET/POST coldtank:x (0 - off, 1 - on)
 GET/POST bvolume:x in mililiters
 POST lastbswap:0
 **/
#include "stdio.h"
#include "unit.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_adc/adc_oneshot.h"
//#include "esp_system.h"
#include "esp_log.h"
//#include "nvs_flash.h"
//#include "esp_bt.h"
#include "driver/uart.h"
#include "freertos/queue.h"
#include "string.h"
#include "main.h"
#include "auxilary_devices.h"
#include "basic_queue.h"


const char		REPLY_200_OK[] = "200 ok";
const char		REPLY_400_BAD[] = "400 bad";
const char		CLOUD_GET_ALL[] = "GET all";
const char		REPLY_KA_ECHO[]	= "@";
const char		HEARTBIT[] = "HB";
const char		CLOUD_POST_power[] = "POST power:";
const char		CLOUD_GET_power[] = "GET power";
const char		CLOUD_POST_sterilstate[] = "POST sterilstate:";
const char		CLOUD_GET_sterilstate[] = "GET sterilstate";
const char		CLOUD_POST_temphot[] = "POST temphot:";
const char		CLOUD_GET_temphot[] = "GET temphot";
const char		CLOUD_POST_tempcold[] = "POST tempcold:";
const char		CLOUD_GET_tempcold[] = "GET tempcold";
const char		CLOUD_POST_tempcarbon[] = "POST tempcarbon:";
const char		CLOUD_GET_tempcarbon[] = "GET tempcarbon";
const char		CLOUD_POST_tempambient[] = "POST tempambient:";
const char		CLOUD_GET_tempambient[] = "GET tempambient";
const char		REPLY_POST_mixer[] = "POST mixer:";
const char		CLOUD_GET_mixer[] = "GET mixer";
const char		CLOUD_GET[]	= "GET";
const char		CLOUD_POST[] = "POST";
const char		CLOUD_GET_serial[] = "GET serial";
const char		CLOUD_POST_serial[] = "POST serial";
const char		CLOUD_GET_datetime[] = "GET datetime";
const char		CLOUD_POST_datetime[] = "POST datetime";
const char		CLOUD_GET_smartfunction[] = "GET smartfunction";
const char		CLOUD_GET_energysaving[] = "GET energysaving";
const char		CLOUD_GET_hotfunction[] = "GET hotfunction";
const char		CLOUD_GET_consumptionhot[] = "GET consumptionhot";
const char		CLOUD_GET_consumptioncold[] = "GET consumptioncold";
const char		CLOUD_GET_consumptioncarbon[] = "GET consumptioncarbon";
const char		CLOUD_GET_consumptionambient[] = "GET consumptionambient";
const char		CLOUD_POST_smartfunction[] = "POST smartfunction";
const char		CLOUD_POST_energysaving[] = "POST energysaving";
const char		CLOUD_POST_hotfunction[] = "POST hotfunction";
const char		CLOUD_GET_ultrasonic[] = "GET ultrasonic";
const char		CLOUD_POST_ultrasonic[] = "POST ultrasonic";
const char		CLOUD_POST_filterchange[] = "POST filterchange";
const char		CLOUD_GET_errors[] = "GET errors";
const char		CLOUD_POST_errorsreset[] = "POST errorsreset";
const char		CLOUD_POST_restart[] = "POST restart";
const char		CLOUD_GET_filterchange[] = "GET filterchange";
const char		CLOUD_GET_filterleft[] = "GET filterleft";
const char		CLOUD_GET_filtertime[] = "GET filtertime";
const char		CLOUD_GET_nwutime[] = "GET nwutime";
const char		CLOUD_POST_filterreset[] = "POST filterreset";
const char		CLOUD_GET_sterilozone[] = "GET sterilozone";
const char		CLOUD_POST_sterilozone[] = "POST sterilozone";
const char		CLOUD_GET_steriluvc[] = "GET steriluvc";
const char		CLOUD_POST_steriluvc[] = "POST steriluvc";
const char		CLOUD_GET_sterilauto[] = "GET sterilauto";
const char		CLOUD_POST_sterilauto[] = "POST sterilauto";
const char		CLOUD_POST_autopowerscheduling[]	= "POST autopowerscheduling";	
const char		CLOUD_GET_autopowerscheduling[] = "GET autopowerscheduling";
const char		CLOUD_POST_sterilscheduling[] = "POST sterilscheduling";
const char		CLOUD_GET_sterilscheduling[] = "GET sterilscheduling";
const char		CLOUD_POST_autopowerswitch[] = "POST autopowerswitch";
const char		CLOUD_GET_autopowerswitch[] = "GET autopowerswitch";
const char		CLOUD_POST_dispense[] = "POST dsp";
const char		CLOUD_POST_cdispense[] = "POST cdsp";
const char		CLOUD_GET_htanktemp[] = "GET htanktemp";
const char		CLOUD_POST_facrotyreset[] = "POST factoryreset";
const char		CLOUD_POST_frliters[] = "POST frliters";
const char		CLOUD_GET_frliters[] = "GET frliters";
const char		CLOUD_POST_frdays[] = "POST frdays";
const char		CLOUD_GET_frdays[] = "GET frdays";
const char		CLOUD_GET_state[] = "GET state";
const char		CLOUD_GET_frnwu[] = "GET frnwu";
const char		CLOUD_POST_frnwu[] = "POST frnwu";
const char		CLOUD_GET_pin[] = "GET pin";
const char		CLOUD_POST_pin[] = "POST pin";
const char		CLOUD_GET_firmwareversion[] = "GET firmwareversion";
const char		CLOUD_GET_EUVC_ON[] = "GET euvcon";
const char		CLOUD_POST_EUVC_ON[] = "POST euvcon";
const char		CLOUD_GET_EUVC_OFF[] = "GET euvcoff";
const char		CLOUD_POST_EUVC_OFF[] = "POST euvcoff";
const char		CLOUD_POST_bvolume[] = "POST bvolume";
const char		CLOUD_GET_bvolume[] = "GET bvolume";
const char  	CLOUD_GET_lastbswap[] = "GET lastbswap";
const char  	CLOUD_POST_lastbswap[] = "POST lastbswap";
const char		CLOUD_GET_consumptiontotal[] = "GET consumptiontotal";
const char		CLOUD_GET_hottank[] = "GET hottank";
const char		CLOUD_POST_hottank[] = "POST hottank";
const char		CLOUD_GET_coldtank[] = "GET coldtank";
const char		CLOUD_POST_coldtank[] = "POST coldtank";

//---
extern 	tBasicQ			CC_input_queue;
extern	QueueHandle_t				CC_output_queue;
extern	QueueHandle_t				UNIT_input_queue;
extern	QueueHandle_t				UNIT_output_queue;
extern	tUNIT    					SIG_unit;
extern  adc_oneshot_unit_handle_t 	adc1_handle;

char					cc_buffer[SPP_DATA_BUFF_MAX_LEN];
int32_t					CLOUD_send_data(char data[]);
uint32_t				check_steriluvc_mode(pUNIT pUnit);
//int32_t				CLOUD_process_CMD(pUNIT pUnit, char data[]);
int32_t					UNIT_data_process(pUNIT pUnit, char * data);
static uint16_t			does_filters_to_be_changed(pUNIT pUnit);

//---
int32_t			init_unit()	
{	
	//here in model shoud print 
	sprintf(SIG_unit.name, "%s", "KU-KU-KU"); ///???
	SIG_unit.ui32ID = 12345678;
	SIG_unit.system.ui32SYSTEM_state = HW_STATE_BOT_PRESENT + HW_STATE_UNIT_ON;
	UNIT_output_queue = xQueueCreate(20, sizeof(uint32_t));
	UNIT_input_queue = xQueueCreate(20, sizeof(uint32_t));
	CC_output_queue = xQueueCreate(10, sizeof(uint32_t));		
	init_BQ(&CC_input_queue);
	SIG_unit.ui32HBTimer = HB_RELOAD;
	return GOOD;
}
//---
/*
int32_t			UNIT_send_data(pUNIT pUnit)
{
	uint32_t	ui32Temp0, ui32Temp1, ui32Temp2;
	char * pData;
	
	return Cloud_CMD_good;
}
	*/
//---
int32_t			UNIT_transmit_data(pUNIT pUnit,  const char * data) {
	uint32_t	ui32Temp;
	char * 		pData;
	// here the question - i must figure out length of the data	
	// than i will allocate data in the range of xxx
	ui32Temp = spp_sprintf(&cc_buffer, "%s\r\n", data);
	pData = malloc(ui32Temp + 1);
	if (pData == NULL) {
		return Cloud_CMD_bad;
	}
	memset((void *)pData, 0x0, ui32Temp+1);
	memcpy((void *)pData, (void *)cc_buffer, ui32Temp);	
	if (xQueueSend(UNIT_output_queue, (void *)&pData, 100*portTICK_PERIOD_MS) != pdPASS)
	{		
		free(pData);
		return Cloud_CMD_bad;
	}	
	return Cloud_CMD_good;
}
//---
int32_t			UNIT_data_process(pUNIT pUnit, char * data)
{
	uint32_t	ui32Temp0;
	uint32_t	ui32Temp1;
	char 		buffer[32];	
	time_t 		TMP;
	
	//--- EXTRA UVC controll	
	///
	ui32Temp0 = sscanf(data, "AT+LOAD=UVC:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if (ui32Temp1 == 0) {			
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_UV_EXTRA_ON;
			return Cloud_CMD_good;
		} else if (ui32Temp1 == 1) {			
			pUnit->system.ui32SYSTEM_state |= HW_STATE_UV_EXTRA_ON;
			return Cloud_CMD_good;
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=HTR:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {		
		if (ui32Temp1 == 0) {			
			if (pUnit->system.ui32SYSTEM_state & STATE_HOT_PUSHED) {
				// here just set ouptut bits
				pUnit->system.ui32SYSTEM_state &= ~(HW_STATE_HOT_ON | STATE_HOT_PUSHED);
			} else {				
				pUnit->system.ui32SYSTEM_state &= ~(HW_STATE_HOT_ON | HW_STATE_HOT_ENABLE);
			}			
			return Cloud_CMD_good;
		} else if (ui32Temp1 == 1) {			
			if (pUnit->system.ui32SYSTEM_state & STATE_HOT_PUSHED) {
				// here just set ouptut bits
				pUnit->system.ui32SYSTEM_state |= HW_STATE_HOT_ON;
				pUnit->system.ui32SYSTEM_state &= ~STATE_HOT_PUSHED;
			} else {
				// if system is in power down mode, 
				pUnit->system.ui32SYSTEM_state |= (HW_STATE_HOT_ON | HW_STATE_HOT_ENABLE | HW_STATE_UNIT_ON);								 
			}						
			return Cloud_CMD_good;
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=CLR:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {		
		if (ui32Temp1 == 0) {			
			if (pUnit->system.ui32SYSTEM_state & STATE_COLD_PUSHED) {
				// here just set ouptut bits
				pUnit->system.ui32SYSTEM_state &= ~(HW_STATE_COLD_ON | STATE_COLD_PUSHED);
			} else {
				pUnit->system.ui32SYSTEM_state &= ~(HW_STATE_COLD_ON | HW_STATE_COLD_ENABLE);
			}			
			return Cloud_CMD_good;
		} else if (ui32Temp1 == 1) {			
			if (pUnit->system.ui32SYSTEM_state & STATE_COLD_PUSHED) {
				// here just set ouptut bits
				pUnit->system.ui32SYSTEM_state |= HW_STATE_COLD_ON;
				pUnit->system.ui32SYSTEM_state &= ~STATE_COLD_PUSHED;
			} else {
				pUnit->system.ui32SYSTEM_state |= (HW_STATE_COLD_ON | HW_STATE_COLD_ENABLE | HW_STATE_UNIT_ON);								 
			}						
			return Cloud_CMD_good;
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=WCS:%lu", &ui32Temp1);
	#if (defined(SS_BOT_DOWN_CHA) || defined(SS_PIPE_CHA) || defined(SS_PIPE_CHS))	
	if (ui32Temp0 > 0) {		
		if (ui32Temp1 < 65535) {
			pUnit->system.ui32WATER_consumption_L = ui32Temp1; // this one not being stored normally, it is rather restore - than this defines amunt used during current session
			pUnit->system.ui32CONSUMPTION_total_L = pUnit->system.ui32CONSUMPTION_SAVED + pUnit->system.ui32WATER_consumption_L;
			//---
			if (SIG_unit.system.ui32Filter_resource_L != 65535) {
				SIG_unit.system.ui32FILTER_used_L = pUnit->system.ui32CONSUMPTION_total_L;  // this value is used in filter estimation
			} else {
				SIG_unit.system.ui32FILTER_used_L = 0;
			}
			//---	
			return Cloud_CMD_good;		
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	#endif
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=CST:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if ((ui32Temp1 >= 2) && (ui32Temp1 <= 15)) {
			pUnit->system.ui32COLD_TMPRT_requested = ui32Temp1;			
			return Cloud_CMD_good;		
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=CTT:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if ((ui32Temp1 >= 0) && (ui32Temp1 <= 45)) {
			pUnit->system.ui32COLD_TMPRT_current = ui32Temp1;			
			return Cloud_CMD_good;		
		} else {			
			return Cloud_CMD_bad;			
		}						
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=HST:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if ((ui32Temp1 >= 80) && (ui32Temp1 <= 94)) {
			pUnit->system.ui32HOT_TMPRT_requested = ui32Temp1;			
			return Cloud_CMD_good;		
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=HTT:%lu", &ui32Temp1);	
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if ((ui32Temp1 >= 0) && (ui32Temp1 <= 105)) {			
			pUnit->system.ui32HOT_TMPRT_current = ui32Temp1;					
			return Cloud_CMD_good;		
		} else {			
			return Cloud_CMD_bad;			
		}								
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=OUT:%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if ((ui32Temp1 >= 0) && (ui32Temp1 <= 111)) {
			if (ui32Temp1 > 0) {
				pUnit->system.ui32FILTER_used_NWU_H = 0;						
			}
			return Cloud_CMD_good;		
		} else {			
			return Cloud_CMD_bad;			
		}								
	}
	//---
	ui32Temp0 = sscanf(data, "AT+LOAD=BOT:%lu", &ui32Temp1);
	#if (defined(SS_BOT_UP_CHA) || defined(SS_BOT_UP_CHS))
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if (ui32Temp1 == 0) {						
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_BOT_PRESENT;
			return Cloud_CMD_good;
		} else if (ui32Temp1 == 1) {	
			// here should control if it is changing from 0 to 1, 
			if (!(pUnit->system.ui32SYSTEM_state & HW_STATE_BOT_PRESENT)) {
				// here update lastbswap time
				time_t	temp = AGE_START_POINT;
				esp_err_t err = ESP_OK;
				err =	RTC_get_time(&temp);
				if (err != ESP_OK)
				{
					ESP_LOGE("GET>", "RTC getting time failed\n");
					temp = pUnit->timeSystem_time;
				}
				pUnit->system.ui32LASTBSWAP = temp;
				// tick counter up
				pUnit->system.ui32WATER_consumption_L += pUnit->system.ui32BOT_VOLUME/1000; // this one not being stored normally, it is rather restore - than this defines amunt used during current session
				pUnit->system.ui32CONSUMPTION_total_L = pUnit->system.ui32CONSUMPTION_SAVED + pUnit->system.ui32WATER_consumption_L;
			}
			// if yes, than count up water consumption counter and set lastbswap time
					
			pUnit->system.ui32SYSTEM_state |= HW_STATE_BOT_PRESENT;
			return Cloud_CMD_good;
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	#endif
	//--- next CO2 control
	ui32Temp0 = sscanf(data, "AT+LOAD=GAS:%lu", &ui32Temp1);
	#if (defined(SS_BOT_UP_CHS) || defined(SS_PIPE_CHS) || defined(SS_BOT_DOWN_CHS))
	if (ui32Temp0 > 0) {
		// question argument must be in the range - 0 or 1
		if (ui32Temp1 == 0) {						
			SIG_unit.system.ui32ERROR_code |= CO2_NO_GAS_ERROR;
			return Cloud_CMD_good;
		} else if (ui32Temp1 == 1) {	
			// here should control if it is changing from 0 to 1, 
			SIG_unit.system.ui32ERROR_code &= ~CO2_NO_GAS_ERROR;			
			return Cloud_CMD_good;
		} else {			
			return Cloud_CMD_bad;			
		}				
	}
	//---
	#endif
	//---
	ui32Temp0 = sscanf(data, "AT+TEST=%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		if (ui32Temp1 == 1) {
			RTC_set_time(pUnit, 946684801);		//setting 01.01.2000. 00:00:01
			RTC_set_register(0xC0, 0); // reseting state ID register to inhibit RTC reload on next start		
		}				
		if (ui32Temp1 == 0) {
			// here reset to default state
			SIG_unit.system.ui32SYSTEM_state = HW_STATE_BOT_PRESENT + HW_STATE_UNIT_ON;
			load_default_parameters(pUnit);	
		}
	}
	//---
	ui32Temp0 = sscanf(data, "AT+TCHCK=%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		if (ui32Temp1 == 1) {
			// here to get time from RTC and reply POSIX			
			RTC_get_time(&TMP);			
			spp_sprintf(buffer, "%llu", TMP);
			UNIT_transmit_data(pUnit, buffer);
		}				
	}	
	//---
	ui32Temp0 = sscanf(data, "AT+ACHCK=%lu", &ui32Temp1);
	if (ui32Temp0 > 0) {
		if (ui32Temp1 == 1) {
			// here to reply with ADC value
			spp_sprintf(buffer, "%lu", (uint32_t)pUnit->ui32ADC_result);
			UNIT_transmit_data(pUnit, buffer);
		}				
	}
	return GOOD;
}
//---
uint32_t			check_steriluvc_mode(pUNIT pUnit)
{	
	if (pUnit->system.ui32SYSTEM_state & HW_STATE_UV_EXTRA_ENABLED) {
		return 2;		
	}
	return 0;		
}
//---
void				UNIT_turn_on_EUVC(void) {
	//--- here set UVC bit 1:
	UNIT_transmit_data(&SIG_unit,  "AT+PUSH=UVC:1") ;	
}
//---
void				UNIT_turn_off_EUVC(void) {
	//--- here set UVC bit 1:
	UNIT_transmit_data(&SIG_unit,  "AT+PUSH=UVC:0") ;	
}
//---
void				UNIT_turn_on_HEATER(void) {
	//--- here set UVC bit 1:
	UNIT_transmit_data(&SIG_unit,  "AT+PUSH=HTR:1") ;	
	SIG_unit.system.ui32SYSTEM_state |= STATE_HOT_PUSHED;
}
//---
void				UNIT_turn_off_HEATER(void) {
	//--- here set UVC bit 1:
	UNIT_transmit_data(&SIG_unit,  "AT+PUSH=HTR:0") ;	
	SIG_unit.system.ui32SYSTEM_state |= STATE_HOT_PUSHED;
}
//---
void				UNIT_turn_on_COOLER(void) {
	//--- here set UVC bit 1:
	UNIT_transmit_data(&SIG_unit,  "AT+PUSH=CLR:1") ;	
	SIG_unit.system.ui32SYSTEM_state |= STATE_COLD_PUSHED;
}
//---
void				UNIT_turn_off_COOLER(void) {
	//--- here set UVC bit 1:
	UNIT_transmit_data(&SIG_unit,  "AT+PUSH=CLR:0") ;	
	SIG_unit.system.ui32SYSTEM_state |= STATE_COLD_PUSHED;
}
//---
void				UNIT_set_cold_T_setpoint(uint32_t T) {
	char buffer[32];	
	spp_sprintf(buffer, "AT+PUSH=CST:%lu", T);
	UNIT_transmit_data(&SIG_unit,  buffer) ;	
}
//---
void				UNIT_set_hot_T_setpoint(uint32_t T) {
	char buffer[32];	
	spp_sprintf(buffer, "AT+PUSH=CST:%lu", T);
	UNIT_transmit_data(&SIG_unit,  buffer) ;	
}
//---
void				UNIT_reset_WCS(void) {
	char buffer[32];	
	spp_sprintf(buffer, "AT+PUSH=WCS:0");

	UNIT_transmit_data(&SIG_unit,  buffer) ;	
}
//---
uint32_t			CT_control_process(void)
{	
	uint32_t	ui32Temp = 0;
	uint32_t	ui32Temp1, ui32Temp2, uit32Temp3;
	uint32_t	ui32FL_H, ui32FL_L;
	int32_t		i32Temp;
	int		i16Temp;
	// 1. RTC tick	
	if (SIG_unit.ui32SEC_timer > 0) {
		SIG_unit.ui32SEC_timer--;
	} else {
		SIG_unit.ui32SEC_timer = SEC_TIMER_RELOAD;
		//--- here can add somethig to be runned one time per minute
		/*
		ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, ADC_CHANNEL_3, &i16Temp));
		// here to implement filtering, well, how we are going to do it?
		// we are taking the difference between recieved data and actual value
		i32Temp = SIG_unit.ui32ADC_result;
		i32Temp = i32Temp + (i16Temp - i32Temp) / 4;
		if (i32Temp < 0) i32Temp = 0;
		//
		SIG_unit.ui32ADC_result = (uint32_t)i32Temp;
		if (SIG_unit.ui32ADC_result < CO2_NO_GAS_THR) {
			// here set error
			SIG_unit.system.ui32ERROR_code |= CO2_NO_GAS_ERROR;
		}
		if (SIG_unit.ui32ADC_result > CO2_GAS_ENOUGH_THR) {
			// here reset error
			SIG_unit.system.ui32ERROR_code &= ~CO2_NO_GAS_ERROR;
		}
		//
		//RTC_tick();
		//--- executing		
		*/		
	}
	//--- here this should be limited 
	if (!(SIG_unit.ui32SEC_timer & 0x3)) {
		if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_UNIT_ON) {
			// here must turn unit on, but only in case if it is not already set
			// keeping configuration as it was, so actually defined by the
			// HW_STATE_HOT_ENABLE and HW_STATE_COLD_ENABLE
			if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_HOT_ENABLE) {
				if (!(SIG_unit.system.ui32SYSTEM_state & HW_STATE_HOT_ON))
					UNIT_turn_on_HEATER();
			}  else {
				if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_HOT_ON)
					UNIT_turn_off_HEATER();
			}
			//---
			if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_COLD_ENABLE) {
				if (!(SIG_unit.system.ui32SYSTEM_state & HW_STATE_COLD_ON))
					UNIT_turn_on_COOLER();
			} else {
				if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_COLD_ON)
					UNIT_turn_off_COOLER();
			}
		} else {
			// here must turn unit off, regardless the HOT_ENABLE and COLD_ENABLE
			if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_HOT_ON) UNIT_turn_off_HEATER();
			if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_COLD_ON) UNIT_turn_off_COOLER();
		}
	}
	//--- here we are processing 
	if ((SIG_unit.system.ui32EUVC_timer & 0x7FFFFFFF) > 0) {
			SIG_unit.system.ui32EUVC_timer--;
	} else {
		// here we are going to reload timer if EUVC is 0, than load on
		if (SIG_unit.system.ui32EUVC_timer > 0) {
			if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_UV_EXTRA_ENABLED) {
				SIG_unit.system.ui32EUVC_timer = SIG_unit.system.ui32EUVC_off_reload;
			} else {
				SIG_unit.system.ui32EUVC_timer = BUVC_off_time;
			}
			ESP_LOGI("SYSTEM_OP>", "SETING UVC OFF");						
			UNIT_turn_off_EUVC();			
		} else {
			if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_UV_EXTRA_ENABLED) {
				SIG_unit.system.ui32EUVC_timer = SIG_unit.system.ui32EUVC_on_reload + 0x80000000;
			} else {
				SIG_unit.system.ui32EUVC_timer = BUVC_on_time + 0x80000000;
			}		
			ESP_LOGI("SYSTEM_OP>", "SETING UVC ON");								
			//send turn on command to the controller			
			UNIT_turn_on_EUVC();
		}
	}
	///
	/*
	if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_UV_EXTRA_ENABLED) {
		// here 
		if ((SIG_unit.system.ui32EUVC_timer & 0x7FFFFFFF) > 0) {
			SIG_unit.system.ui32EUVC_timer--;
		} else {
			// here we are going to reload timer if EUVC is 0, than load on
			if (SIG_unit.system.ui32EUVC_timer > 0) {
				SIG_unit.system.ui32EUVC_timer = SIG_unit.system.ui32EUVC_off_reload;
				//send turn off command to the controller
				SIG_unit.system.ui32SYSTEM_state &= ~HW_STATE_UV_EXTRA_ON;	
				UNIT_turn_off_EUVC();			
			} else {
				SIG_unit.system.ui32EUVC_timer = SIG_unit.system.ui32EUVC_on_reload + 0x80000000;
				//send turn on command to the controller
				SIG_unit.system.ui32SYSTEM_state |= HW_STATE_UV_EXTRA_ON;
				UNIT_turn_on_EUVC();
			}
		}
	} else {
		//here must send OFF command if EUVC is on
		// here we are also running the same UVC control, but with differen times

		
		if (SIG_unit.system.ui32SYSTEM_state & HW_STATE_UV_EXTRA_ON) {
			SIG_unit.system.ui32SYSTEM_state &= ~HW_STATE_UV_EXTRA_ON;
			//send turn off command to the controller
		}		
	
	}
	*/
			
	//---
	if (SIG_unit.ui32HOUR_timer > 0) {
		SIG_unit.ui32HOUR_timer--;
	} else {
		if (SIG_unit.system.ui32Filter_resource_Days != 65535) {
			SIG_unit.system.ui32FILTER_used_H++;
		}
		//---
		if (SIG_unit.system.ui32Filter_resource_NWU_Days != 65535) {
			SIG_unit.system.ui32FILTER_used_NWU_H++;
		}
		//---
		SIG_unit.ui32HOUR_timer = HOUR_TIMER_RELOAD;
		save_to_NVS(&SIG_unit);
	}
	//--- resource left update
	ui32FL_H = 10000;
	ui32FL_L = 10000;
	if (SIG_unit.system.ui32Filter_resource_Days != 65535)
	{
		ui32Temp1 = SIG_unit.system.ui32Filter_resource_Days*24;
		ui32Temp2 = ui32Temp1;
		if (SIG_unit.system.ui32FILTER_used_H > ui32Temp1) {
			ui32FL_H = 0;
			SIG_unit.system.ui32ERROR_code |= FILTER_MAX_LEVEL_ERROR;
		} else {
			ui32Temp1 = 10000*(ui32Temp1 - SIG_unit.system.ui32FILTER_used_H);
			ui32FL_H =ui32Temp1/ui32Temp2;
		}		
	}
	//---
	if (SIG_unit.system.ui32Filter_resource_L != 65535)
	{
		ui32Temp1 = SIG_unit.system.ui32Filter_resource_L;
		ui32Temp2 = ui32Temp1;
		if (SIG_unit.system.ui32FILTER_used_L > ui32Temp1) {
			ui32FL_L = 0;
			SIG_unit.system.ui32ERROR_code |= FILTER_MAX_LEVEL_ERROR;
		} else {
			ui32Temp1 = 10000*(ui32Temp1 - SIG_unit.system.ui32FILTER_used_L);
			ui32FL_L =ui32Temp1/ui32Temp2;
		}		
	}
	//---
	if (SIG_unit.system.ui32Filter_resource_NWU_Days != 65535) {
		ui32Temp1 = SIG_unit.system.ui32Filter_resource_NWU_Days*24;
		if (SIG_unit.system.ui32FILTER_used_NWU_H > ui32Temp1) {
			ui32FL_H = 0;
			SIG_unit.system.ui32ERROR_code |= FILTR_NWU_REACHED_ERROR;
		}
	}
	//---
	if (ui32FL_H < ui32FL_L) {
		SIG_unit.system.ui32FILTER_resource_left = ui32FL_H;
	} else {
		SIG_unit.system.ui32FILTER_resource_left = ui32FL_L;
	}
	//---

	//---
	return ui32Temp;	
}
//---
int32_t			init_bt_adv_data(uint8_t  data[])
{
	//here basing on HW configuration and serial number should generate device name
	//here inital communication from unit is already recieved, so serial is known
	uint32_t	serial_nr;
	char buffer[9];
	//--- test purposes only
	//SIG_unit.ui32HW_configuration = (UV_present_bit | PAST_present_bit | HW_present_bit | HT_thermostat_present_bit | CW_present_bit | AW_present_bit | CO2W_present_bit | FILTERS_used_bit | USS_present_bit);		
	//---
	data[0] = 0x02;
	data[1] = 0x01;
	data[2] = 0x06;
	data[3] = 0x03;
	data[4] = 0x03;
	data[5] = 0xF0;
	data[6] = 0xAB;
	data[7] = 0x0F;
	data[8] = 0x09;
	//---
	//data[9] = 'C';
	//data[10] = 'T';
	//---
	serial_nr = SIG_unit.ui32ID;	
	//--- 
	#ifdef SS_BOT_DOWN_CHA
	data[9] = 'S';
	data[10] = 'D';
	data[11] = 'x';
	data[12] = 'H';
	data[13] = 'C';
	data[14] = 'A';	
	#endif
	#ifdef SS_BOT_DOWN_CHS
	data[9] = 'S';
	data[10] = 'D';
	data[11] = 'x';
	data[12] = 'H';
	data[13] = 'C';
	data[14] = 'S';	
	#endif
	#ifdef SS_BOT_UP_CHA
	data[9] = 'S';
	data[10] = 'U';
	data[11] = 'x';
	data[12] = 'H';
	data[13] = 'C';
	data[14] = 'A';	
	#endif
	#ifdef SS_BOT_UP_CHS
	data[9] = 'S';
	data[10] = 'U';
	data[11] = 'x';
	data[12] = 'H';
	data[13] = 'C';
	data[14] = 'S';	
	#endif
	#ifdef SS_PIPE_CHA
	data[9] = 'S';
	data[10] = 'N';
	data[11] = 'x';
	data[12] = 'H';
	data[13] = 'C';
	data[14] = 'A';	
	#endif 
	#ifdef SS_PIPE_CHS
	data[9] = 'S';
	data[10] = 'N';
	data[11] = 'x';
	data[12] = 'H';
	data[13] = 'C';
	data[14] = 'S';	
	#endif
	#ifdef COLOR_BLACK
	data[11] = 'B';
	#endif
	#ifdef COLOR_WHITE
	data[11] = 'W';
	#endif

	//---			
	sprintf(buffer, "%08lu", serial_nr);
	data[15] = buffer[0];
	data[16] = buffer[1];
	data[17] = buffer[2];
	data[18] = buffer[3];
	data[19] = buffer[4];
	data[20] = buffer[5];
	data[21] = buffer[6];
	data[22] = buffer[7];
	//---
	// we are going also to initialize 
	//---
	return Cloud_CMD_good;
}
	
//
int32_t			CLOUD_send_data(char data[])
{
	//here we are going to?
	//should push this data in the CC_OUT queue
	//queue consists of pointers to elements elements 
	// as input we are getting pointer to element, 
	// should reserve the same size and copy this data to this area, after can add it to queue
	char * pData;
	uint32_t	ui32Temp = strlen(data);
	pData = malloc(ui32Temp + 3);
	memset((void *)pData, 0x0, ui32Temp + 3);
	memcpy((void *)pData, (void *)data, ui32Temp);
	pData[ui32Temp] = (char)13;
	pData[ui32Temp + 1] = (char)10;	
	//ESP_LOGI("CLD>", "%s", pData);
	if (xQueueSend(CC_output_queue, (void *)&pData, 100*portTICK_PERIOD_MS) != pdPASS)
	{
		//here error, adding to queue failed
		free(pData);
	}
	return GOOD;
}
//---
int32_t			CLOUD_process_CMD(pUNIT pUnit, char  * data)
{
	//here in 
	// check data	
	if(strncmp(data, CLOUD_GET, sizeof(CLOUD_GET) - 1) == 0)
	{
		//here get request		
		if(strncmp(data, CLOUD_GET_ALL, sizeof(CLOUD_GET_ALL) - 1) == 0)
		{
			return Cloud_GET_all_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_power, sizeof(CLOUD_GET_power) - 1) == 0)
		{
			return Cloud_GET_power_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_serial, sizeof(CLOUD_GET_serial) - 1) == 0)
		{
			return Cloud_GET_serial_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_datetime, sizeof(CLOUD_GET_datetime) - 1) == 0)
		{
			return Cloud_GET_datetime_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_smartfunction, sizeof(CLOUD_GET_smartfunction) - 1) == 0)
		{
			return Cloud_GET_smartfunction_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_energysaving, sizeof(CLOUD_GET_energysaving) - 1) == 0)
		{
			return Cloud_GET_energysaving_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_hotfunction, sizeof(CLOUD_GET_hotfunction) - 1) == 0)
		{
			return Cloud_GET_hotfunction_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_temphot, sizeof(CLOUD_GET_temphot) - 1) == 0)
		{
			return Cloud_GET_temphot_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_tempcold, sizeof(CLOUD_GET_tempcold) - 1) == 0)
		{
			return Cloud_GET_tempcold_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_tempcarbon, sizeof(CLOUD_GET_tempcarbon) - 1) == 0)
		{
			return Cloud_GET_tempcarbon_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_tempambient, sizeof(CLOUD_GET_tempambient) - 1) == 0)
		{
			return Cloud_GET_tempambient_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_mixer, sizeof(CLOUD_GET_mixer) - 1) == 0)
		{
			return Cloud_GET_mixer_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_consumptionhot, sizeof(CLOUD_GET_consumptionhot) - 1) == 0)
		{
			return Cloud_GET_consumptionhot_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_consumptioncold, sizeof(CLOUD_GET_consumptioncold) - 1) == 0)
		{
			return Cloud_GET_consumptioncold_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_consumptioncarbon, sizeof(CLOUD_GET_consumptioncarbon) - 1) == 0)
		{
			return Cloud_GET_consumptioncarbon_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_consumptionambient, sizeof(CLOUD_GET_consumptionambient) - 1) == 0)
		{
			return Cloud_GET_consumptionambient_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_sterilozone, sizeof(CLOUD_GET_sterilozone) - 1) == 0)
		{
			return Cloud_GET_sterilozone_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_steriluvc, sizeof(CLOUD_GET_steriluvc) - 1) == 0)
		{
			return Cloud_GET_steriluvc_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_sterilauto, sizeof(CLOUD_GET_sterilauto) - 1) == 0)
		{
			return Cloud_GET_sterilauto_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_sterilscheduling, sizeof(CLOUD_GET_sterilscheduling) - 1) == 0)
		{
			return Cloud_GET_sterilscheduling_reply(pUnit);
		}	
		//---				
		if(strncmp(data, CLOUD_GET_sterilstate, sizeof(CLOUD_GET_sterilstate) - 1) == 0)
		{
			return Cloud_GET_sterilstate_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_errors, sizeof(CLOUD_GET_errors) - 1) == 0)
		{
			return Cloud_GET_errors_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_filterchange, sizeof(CLOUD_GET_filterchange) - 1) == 0)
		{
			return Cloud_GET_filterchange_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_filterleft, sizeof(CLOUD_GET_filterleft) - 1) == 0)
		{
			return Cloud_GET_filterleft_reply(pUnit);
		}						
		//---
		if(strncmp(data, CLOUD_GET_autopowerswitch, sizeof(CLOUD_GET_autopowerswitch) - 1) == 0)
		{
			return Cloud_GET_autopowerswitch_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_autopowerscheduling, sizeof(CLOUD_GET_autopowerscheduling) - 1) == 0)
		{
			return Cloud_GET_autopowerscheduling_reply(pUnit);
		}					
		//---
		if(strncmp(data, CLOUD_GET_ultrasonic, sizeof(CLOUD_GET_ultrasonic) - 1) == 0)
		{
			return Cloud_GET_ultrasonic_reply(pUnit);
		}
		//---
		if(strncmp(data, CLOUD_GET_htanktemp, sizeof(CLOUD_GET_htanktemp) - 1) == 0)
		{
			return Cloud_GET_htanktemp_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_frliters, sizeof(CLOUD_GET_frliters) - 1) == 0)
		{
			return Cloud_GET_frliters_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_frdays, sizeof(CLOUD_GET_frdays) - 1) == 0)
		{
			return Cloud_GET_frdays_reply(pUnit);
		}	
		//---
		if (strncmp(data, CLOUD_GET_state, sizeof(CLOUD_GET_state) - 1) == 0)
		{
			return Cloud_GET_state_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_frnwu, sizeof(CLOUD_GET_frnwu) - 1) == 0)
		{
			return Cloud_GET_frnwu_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_pin, sizeof(CLOUD_GET_pin) - 1) == 0)
		{
			return Cloud_GET_pin_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_filtertime, sizeof(CLOUD_GET_filtertime) - 1) == 0)
		{
			return Cloud_GET_filtertime_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_nwutime, sizeof(CLOUD_GET_nwutime) - 1) == 0)
		{
			return Cloud_GET_nwutime_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_firmwareversion, sizeof(CLOUD_GET_firmwareversion) - 1) == 0)
		{
			return Cloud_GET_firmwareversion_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_EUVC_ON, sizeof(CLOUD_GET_EUVC_ON) - 1) == 0)
		{
			return Cloud_GET_EUVC_ON_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_EUVC_OFF, sizeof(CLOUD_GET_EUVC_OFF) - 1) == 0)
		{
			return Cloud_GET_EUVC_OFF_reply(pUnit);
		}
		//
		if (strncmp(data, CLOUD_GET_bvolume, sizeof(CLOUD_GET_bvolume) - 1) == 0)
		{
			return Cloud_GET_bvolume_reply(pUnit);
		}
		//
		if (strncmp(data, CLOUD_GET_lastbswap, sizeof(CLOUD_GET_lastbswap) - 1) == 0)
		{
			return Cloud_GET_lastbswap_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_consumptiontotal, sizeof(CLOUD_GET_consumptiontotal) - 1) == 0)
		{
			return Cloud_GET_consumptiontotal_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_hottank, sizeof(CLOUD_GET_hottank) - 1) == 0)
		{
			return Cloud_GET_hottank_reply(pUnit);
		}
		//---
		if (strncmp(data, CLOUD_GET_coldtank, sizeof(CLOUD_GET_coldtank) - 1) == 0)
		{
			return Cloud_GET_coldtank_reply(pUnit);
		}		
	}
	if (strncmp(data, CLOUD_POST, sizeof(CLOUD_POST) - 1) == 0)
	{
		if (strncmp(data, CLOUD_POST_datetime, sizeof(CLOUD_POST_datetime) - 1) == 0)
		{
			return Cloud_POST_datetime_reply(pUnit, data);
		}
		if (strncmp(data, CLOUD_POST_dispense, sizeof(CLOUD_POST_dispense) - 1) == 0)
		{
			return Cloud_POST_dispense_reply(pUnit, data);
		}
		if (strncmp(data, CLOUD_POST_cdispense, sizeof(CLOUD_POST_cdispense) - 1) == 0)
		{
			return Cloud_POST_cdispense_reply(pUnit, data);
		}
		//here get request
		if(strncmp(data, CLOUD_POST_power, sizeof(CLOUD_POST_power) - 1) == 0)
		{
			return Cloud_POST_power_reply(pUnit, data);
		}		
		//
		if(strncmp(data, CLOUD_POST_smartfunction, sizeof(CLOUD_POST_smartfunction) - 1) == 0)
		{
			return Cloud_POST_smartfunction_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_energysaving, sizeof(CLOUD_POST_energysaving) - 1) == 0)
		{
			return Cloud_POST_energysaving_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_hotfunction, sizeof(CLOUD_POST_hotfunction) - 1) == 0)
		{
			return Cloud_POST_hotfunction_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_temphot, sizeof(CLOUD_POST_temphot) - 1) == 0)
		{
			return Cloud_POST_temphot_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_tempcold, sizeof(CLOUD_POST_tempcold) - 1) == 0)
		{
			return Cloud_POST_tempcold_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_tempcarbon, sizeof(CLOUD_POST_tempcarbon) - 1) == 0)
		{
			return Cloud_POST_tempcarbon_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_tempambient, sizeof(CLOUD_POST_tempambient) - 1) == 0)
		{
			return Cloud_POST_tempambient_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_sterilauto, sizeof(CLOUD_POST_sterilauto) - 1) == 0)
		{
			return Cloud_POST_sterilauto_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_sterilozone, sizeof(CLOUD_POST_sterilozone) - 1) == 0)
		{
			return Cloud_POST_sterilozone_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_steriluvc, sizeof(CLOUD_POST_steriluvc) - 1) == 0)
		{
			return Cloud_POST_steriluvc_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_sterilscheduling, sizeof(CLOUD_POST_sterilscheduling) - 1) == 0)
		{
			return Cloud_POST_sterilscheduling_reply(pUnit, data);			
		}
		//---
		if(strncmp(data, CLOUD_POST_sterilstate, sizeof(CLOUD_POST_sterilstate) - 1) == 0)
		{
			return Cloud_POST_sterilstate_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_filterreset, sizeof(CLOUD_POST_filterreset) - 1) == 0)
		{
			return Cloud_POST_filterreset_reply(pUnit, data);
		}
		//---				
		if (strncmp(data, CLOUD_POST_filterchange, sizeof(CLOUD_POST_filterchange) - 1) == 0)
		{
			return Cloud_POST_filterchange_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_errorsreset, sizeof(CLOUD_POST_errorsreset) - 1) == 0)
		{
			return Cloud_POST_errorsreset_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_restart, sizeof(CLOUD_POST_restart) - 1) == 0)
		{
			return Cloud_POST_restart_reply(pUnit, data);
		}
		//---
		if(strncmp(data, CLOUD_POST_autopowerswitch, sizeof(CLOUD_POST_autopowerswitch) - 1) == 0)
		{
			return Cloud_POST_autopowerswitch_reply(pUnit, data);			
		}
		//---
		
		if(strncmp(data, CLOUD_POST_autopowerscheduling, sizeof(CLOUD_POST_autopowerscheduling) - 1) == 0)
		{
			return Cloud_POST_autopowerscheduling_reply(pUnit, data);			
		}	
		//---
		if(strncmp(data, CLOUD_POST_ultrasonic, sizeof(CLOUD_POST_ultrasonic) - 1) == 0)
		{
			return Cloud_POST_ultrasonic_reply(pUnit, data);
		}
		//---			
		if (strncmp(data, CLOUD_POST_facrotyreset, sizeof(CLOUD_POST_facrotyreset) - 1) == 0)
		{
			return Cloud_POST_factoryreset_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_frliters, sizeof(CLOUD_POST_frliters) - 1) == 0)
		{
			return Cloud_POST_frliters_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_frdays, sizeof(CLOUD_POST_frdays) - 1) == 0)
		{
			return Cloud_POST_frdays_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_serial, sizeof(CLOUD_POST_serial) - 1) == 0)
		{
			return Cloud_POST_serial_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_pin, sizeof(CLOUD_POST_pin) - 1) == 0)
		{
			return Cloud_POST_pin_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_frnwu, sizeof(CLOUD_POST_frnwu) - 1) == 0)
		{
			return Cloud_POST_frnwu_reply(pUnit, data);
		}
		//---		
		if (strncmp(data, CLOUD_POST_EUVC_ON, sizeof(CLOUD_POST_EUVC_ON) - 1) == 0)
		{
			return Cloud_POST_EUVC_ON_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_EUVC_OFF, sizeof(CLOUD_POST_EUVC_OFF) - 1) == 0)
		{
			return Cloud_POST_EUVC_OFF_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_bvolume, sizeof(CLOUD_POST_bvolume) - 1) == 0)
		{
			return Cloud_POST_bvolume_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_lastbswap, sizeof(CLOUD_POST_lastbswap) - 1) == 0)
		{
			return Cloud_POST_lastbswap_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_hottank, sizeof(CLOUD_POST_hottank) - 1) == 0)
		{
			return Cloud_POST_hottank_reply(pUnit, data);
		}
		//---
		if (strncmp(data, CLOUD_POST_coldtank, sizeof(CLOUD_POST_coldtank) - 1) == 0)
		{
			return Cloud_POST_coldtank_reply(pUnit, data);
		}
		
	}
	//---
	if (strcmp(data, HEARTBIT) == 0)
	{
		CLOUD_send_data("200 HB:ok");	
		return Cloud_CMD_good;
	}
	//---
	CLOUD_send_data("400 message: Uknown command");
	return Cloud_CMD_bad;
}
//---
int32_t			Cloud_GET_consumptiontotal_reply(pUNIT pUnit) {
	spp_sprintf(&cc_buffer, "200 consumptiontotal:%lu", pUnit->system.ui32CONSUMPTION_total_L);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_lastbswap_reply(pUNIT pUnit) {
	spp_sprintf(&cc_buffer, "200 lastbswap:%lu", pUnit->system.ui32LASTBSWAP);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_POST_lastbswap_reply(pUNIT pUnit, char data[]) {
	// here last swap time being supplied to the system externally
	uint32_t	temp;
	if (sscanf(data, "POST lastbswap:%lu", &temp) == 1) 
	{
		if (temp < pUnit->timeSystem_time) {			
			if (temp !=0) {
				pUnit->system.ui32LASTBSWAP = temp;
			} else {				
				pUnit->system.ui32LASTBSWAP = pUnit->timeSystem_time;
				pUnit->system.ui32CONSUMPTION_total_L = 0;
				pUnit->system.ui32WATER_consumption_L = 0;
			}
			
			CLOUD_send_data("200 ok");		
			return save_to_NVS(pUnit);
		}
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}

//--- post/get hottank
int32_t			Cloud_GET_hottank_reply(pUNIT pUnit)
{
	//--- HW_STATE_HOT_ON
	if ((pUnit->system.ui32SYSTEM_state & HW_STATE_HOT_ON)) {
		spp_sprintf(&cc_buffer, "200 hottank:1");
	} else {
		spp_sprintf(&cc_buffer, "200 hottank:0");
	}
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
	//---	
}
//
int32_t			Cloud_POST_hottank_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST hottank:%lu", &temp) == 1) 
	{
		if (temp == 0) {
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_HOT_ENABLE;
			//UNIT_turn_off_HEATER();
			CLOUD_send_data("200 ok");		
			return Cloud_CMD_good;
		} else if (temp == 1) {
			pUnit->system.ui32SYSTEM_state |= (HW_STATE_HOT_ENABLE + HW_STATE_UNIT_ON);			
			//UNIT_turn_on_HEATER();
			CLOUD_send_data("200 ok");		
			return Cloud_CMD_good;
		}				
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//--- post/get coldtank
int32_t			Cloud_GET_coldtank_reply(pUNIT pUnit)
{
	//--- HW_STATE_COLD_ON
	if ((pUnit->system.ui32SYSTEM_state & HW_STATE_COLD_ON)) {
		spp_sprintf(&cc_buffer, "200 coldtank:1");
	} else {
		spp_sprintf(&cc_buffer, "200 coldtank:0");
	}
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
	//---	
}
//
int32_t			Cloud_POST_coldtank_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST coldtank:%lu", &temp) == 1) 
	{
		if (temp == 0) {
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_COLD_ENABLE;
			CLOUD_send_data("200 ok");		
			return Cloud_CMD_good;
		} else if (temp == 1) {
			pUnit->system.ui32SYSTEM_state |= (HW_STATE_COLD_ENABLE + HW_STATE_UNIT_ON);
			CLOUD_send_data("200 ok");		
			return Cloud_CMD_good;
		}				
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//--- post/get for the bvolume
int32_t			Cloud_GET_bvolume_reply(pUNIT pUnit)
{
	//---
	spp_sprintf(&cc_buffer, "200 bvolume:%lu", (uint32_t)pUnit->system.ui32BOT_VOLUME); // here we are converting back from 100ms ticks to seconds	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
	//---	
}
//---
int32_t			Cloud_POST_bvolume_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST bvolume:%lu", &temp) == 1) 
	{		
		if ((temp <= 25000)) {
			pUnit->system.ui32BOT_VOLUME = temp; 
			CLOUD_send_data("200 ok");		
			return save_to_NVS(pUnit);
		} 
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_EUVC_ON_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST euvcon:%lu", &temp) == 1) 
	{
		//here 
		//here compare with max and min value value to be reported in seconds max time 3600 - 1 hours, min time 1 sec
		if ((temp >= 1)	 && (temp <= 3600)) {
			pUnit->system.ui32EUVC_on_reload = temp*10; // here we are converting seconds to 100ms ticks
			CLOUD_send_data("200 ok");		
			return save_to_NVS(pUnit);
		} 
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_EUVC_OFF_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST euvcoff:%lu", &temp) == 1)
	{
		//here 
		//here compare with max and min value value to be reported in seconds max time 24 hours == 86400 seconds, min time 1 sec
		if ((temp >= 1)	 && (temp <= 86400)) {
			pUnit->system.ui32EUVC_off_reload = temp*10; // we are saving in 100ms ticks, so should multiply by 10
			CLOUD_send_data("200 ok");		
			return save_to_NVS(pUnit);
		} 
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_GET_EUVC_ON_reply(pUNIT pUnit)
{
	//---
	spp_sprintf(&cc_buffer, "200 euvcon:%lu", (uint32_t)pUnit->system.ui32EUVC_on_reload / 10); // here we are converting back from 100ms ticks to seconds	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
	//---	
}
//---
int32_t			Cloud_GET_EUVC_OFF_reply(pUNIT pUnit)
{
	//---
	spp_sprintf(&cc_buffer, "200 euvcoff:%lu", (uint32_t)pUnit->system.ui32EUVC_off_reload / 10); // here we are converting back from 100ms ticks to seconds	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
	//---	
}
//---
int32_t			Cloud_POST_serial_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST serial:%lu", &temp) == 1)
	{
		//here 
		pUnit->ui32ID = temp;
		CLOUD_send_data("200 ok");		
		return save_to_NVS(pUnit);
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_frliters_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;	
	//---	
	if (sscanf(data, "POST frliters:%lu", &temp) == 1)
	{		
		if ((temp <= 65535) && (temp > 0))
		{				
			pUnit->system.ui32Filter_resource_L = temp;				
			CLOUD_send_data("200 ok");				
			return save_to_NVS(pUnit);				
		}
		else
		{
			CLOUD_send_data("400 message: Data failure");
			return BAD;	
		}												
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_frdays_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;	
	//---
	if (sscanf(data, "POST frdays:%lu", &temp) == 1)
	{		
		if (((temp > 0) && (temp <= 2000)) || (temp == 65535)) // 65535 is special value for no time controlled filter change
		{				
			pUnit->system.ui32Filter_resource_Days = temp;
			CLOUD_send_data("200 ok");			
			return save_to_NVS(pUnit);				
		}
		else
		{
			CLOUD_send_data("400 message: Data failure");
			return BAD;	
		}			
										
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_factoryreset_reply(pUNIT pUnit, char data[])	
{
	uint32_t	temp;		
	if (sscanf(data, "POST factoryreset:%lu", &temp) == 1)
	{		
		if (temp == 1)
		{								

			SIG_unit.system.ui32SYSTEM_state = HW_STATE_BOT_PRESENT + HW_STATE_UNIT_ON;
			load_default_parameters(pUnit);	
		}
		CLOUD_send_data("200 ok");
		return save_to_NVS(pUnit);																							
	}
	CLOUD_send_data("400 message: Data failure");
	return Cloud_CMD_bad;			
}
//---
int32_t			Cloud_POST_sterilscheduling_reply(pUNIT pUnit, char data[])
{
	
	CLOUD_send_data("400 message: Data failure");	
	return Cloud_CMD_bad;
}
//---
int32_t			Cloud_POST_datetime_reply(pUNIT pUnit, char data[])	
{
	time_t	temp;
	esp_err_t	err = ESP_OK;
	if (sscanf(data, "POST datetime:%llu", &temp) == 1)
	{		
		if ((temp >= AGE_START_POINT) && (temp <= 0xFFFFFFFFFFFFFFFF))
		{
			ESP_LOGI("POST datetime>", "RTC setting time %llu\n", temp);
			err = RTC_set_time(pUnit, temp);
			if (err != ESP_OK)
			{				
				ESP_LOGE("POST>", "RTC setting time failed\n");
				return Cloud_CMD_bad;
			}			
			CLOUD_send_data("200 ok");
			return save_to_NVS(pUnit);												
		}									
	}
	CLOUD_send_data("400 message: Data failure");
	return Cloud_CMD_bad;				
}
//---
int32_t			Cloud_POST_dispense_reply(pUNIT pUnit, char data[])	
{
	uint32_t	temp;
	if (sscanf(data, "POST dsp:%lu", &temp) == 1)
	{						
		return Cloud_CMD_good;										
	}
	CLOUD_send_data("400 message: Data failure");
	return Cloud_CMD_bad;				
}
//---
int32_t			Cloud_POST_cdispense_reply(pUNIT pUnit, char data[])	
{
	uint32_t	temp;
	if (sscanf(data, "POST cdsp:%lu", &temp) == 1)
	{				
		return Cloud_CMD_good;									
	}
	CLOUD_send_data("400 message: Data failure");
	return Cloud_CMD_bad;				
}

//---
int32_t			Cloud_POST_restart_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	// do we have to do something here?
	if (sscanf(data, "POST restart:%lu", &temp) == 1)
	{						
		CLOUD_send_data( "200 ok");			
		return Cloud_CMD_good;								
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_errorsreset_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST errorsreset:%lu", &temp) == 1)
	{				
		if (temp == 1)
		{		
			pUnit->system.ui32ERROR_code = 0;
		}			
		CLOUD_send_data( "200 ok");			
		return Cloud_CMD_good;								
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_filterchange_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST filterchange:%lu", &temp) == 1)
	{
		CLOUD_send_data( "200 ok");
		
		return Cloud_CMD_good;
	}									
	CLOUD_send_data( "400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_sterilozone_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST sterilozone:%lu", &temp) == 1)
	{
		CLOUD_send_data( "200 ok");
		return Cloud_CMD_good;										
	}
	CLOUD_send_data( "400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_POST_steriluvc_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST steriluvc:%lu", &temp) == 1)
	{
		if((temp >= 1) && (temp < 4))
		{
			// ok, here we are recieving 2 - means run extra UVC, settign 0 or 1 - means nothing
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_UV_EXTRA_ENABLED;
			if (temp == 3) {
				pUnit->system.ui32SYSTEM_state |= HW_STATE_UV_EXTRA_ENABLED;				
			} 					
			CLOUD_send_data("200 ok");			
			return Cloud_CMD_good;
		}								
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;
}
//---
int32_t			Cloud_POST_sterilauto_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST sterilauto:%lu", &temp) == 1)
	{		
		CLOUD_send_data( "200 ok");						
		return Cloud_CMD_good;											
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_filterreset_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST filterreset:%lu", &temp) == 1)
	{
		if (temp == 1)
		{
			// here to reset filters
			pUnit->system.ui32FILTER_used_H = 0;
			pUnit->system.ui32FILTER_used_L = 0;
			pUnit->system.ui32FILTER_used_NWU_H = 0;
			pUnit->system.ui32WATER_consumption_L = 0;
			pUnit->system.ui32CONSUMPTION_total_L = 0;			
			SIG_unit.system.ui32ERROR_code &= ~(FILTER_MAX_LEVEL_ERROR | FILTR_NWU_REACHED_ERROR);
			// next save reset date
			RTC_get_time(&pUnit->system.ui32FILTER_reset_POSIX_time);
		}			
		CLOUD_send_data( "200 ok");
		return save_to_NVS(pUnit);
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_sterilstate_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST sterilstate:%lu", &temp) == 1)
	{	
		CLOUD_send_data( "200 ok");
		return Cloud_CMD_good;
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_tempcarbon_reply(pUNIT pUnit, char data[])
{
	//carbon set ignored
	CLOUD_send_data( "200 ok");
	return Cloud_CMD_good;	
}
//---
int32_t			Cloud_POST_tempcold_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST tempcold:%lu", &temp) == 1)
	{
		if ((temp >= 7) && (temp <= 34))
		{
			CLOUD_send_data( "200 ok");
			return Cloud_CMD_good;
		}		
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_tempambient_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST tempambient:%lu", &temp) == 1)
	{
		if ((temp >= 7) && (temp <= 37))
		{
			CLOUD_send_data( "200 ok");
			return Cloud_CMD_good;
		}		
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_temphot_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST temphot:%lu", &temp) == 1)
	{
		if ((temp >=60) && (temp <= 98))
		{			
			CLOUD_send_data( "200 ok");
			return Cloud_CMD_good;
		}		
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}

//---
int32_t			Cloud_POST_ultrasonic_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;			
	if (sscanf(data, "POST ultrasonic:%lu", &temp) == 1)
	{
		CLOUD_send_data( "200 ok");
		return Cloud_CMD_good;
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}

//---
int32_t			Cloud_POST_hotfunction_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST hotfunction:%lu", &temp) == 1)
	{
		CLOUD_send_data( "200 ok");
		return Cloud_CMD_good;
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_energysaving_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST energysaving:%lu", &temp) == 1)
	{
		if (temp == 1) {
			// set
			pUnit->system.ui32SYSTEM_state |= HW_STATE_AUTO_ON;
		} else if (temp == 0) {
			//reset
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_AUTO_ON;
		} else {
			CLOUD_send_data( "400 message: Data failure");
			return Cloud_CMD_bad;	
		}
		CLOUD_send_data( "200 ok");
		return save_to_NVS(pUnit);;
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_autopowerswitch_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST autopowerswitch:%lu", &temp) == 1)
	{
		if (temp == 1) {
			// set
			pUnit->system.ui32SYSTEM_state |= HW_STATE_AUTO_ON;
		} else if (temp == 0) {
			//reset
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_AUTO_ON;
		} else {
			CLOUD_send_data( "400 message: Data failure");
			return Cloud_CMD_bad;	
		}
		CLOUD_send_data( "200 ok");
		return save_to_NVS(pUnit);;
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_smartfunction_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST smartfunction:%lu", &temp) == 1)
	{
		CLOUD_send_data( "200 ok");
		return Cloud_CMD_good;
	}
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_POST_power_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp;
	if (sscanf(data, "POST power:%lu", &temp) == 1)
	{		
		if (temp == 1) {
			pUnit->system.ui32SYSTEM_state |= HW_STATE_UNIT_ON;
		} else if (temp == 0) {
			pUnit->system.ui32SYSTEM_state &= ~HW_STATE_UNIT_ON;
		} else {
			CLOUD_send_data( "400 message: Data failure");
			return Cloud_CMD_bad;	
		}			
		CLOUD_send_data( "200 ok");
		return Cloud_CMD_good;
	} 
	CLOUD_send_data( "400 message: Data failure");
	return Cloud_CMD_bad;	
}
//---
int32_t			Cloud_GET_sterilscheduling_reply(pUNIT pUnit)
{		
	spp_sprintf(&cc_buffer, "200 sterilscheduling:;");		
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
int32_t			Cloud_GET_htanktemp_reply(pUNIT pUnit)
{
	spp_sprintf(&cc_buffer, "200 htanktemp:%u", (uint16_t)0);	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_frliters_reply(pUNIT pUnit)
{
	uint16_t	temp = (uint16_t)(pUnit->system.ui32Filter_resource_L & 0x0000FFFF);
	spp_sprintf(&cc_buffer, "200 frliters:%u", temp);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;			
}
//---
int32_t			Cloud_GET_frdays_reply(pUNIT pUnit)
{
	uint16_t	temp = (uint16_t)(pUnit->system.ui32Filter_resource_Days & 0x0000FFFF);
	spp_sprintf(&cc_buffer, "200 frdays:%u", temp);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;					
}
//---
int32_t			Cloud_GET_frnwu_reply(pUNIT pUnit)
{
	uint16_t	temp = (uint16_t)(pUnit->system.ui32Filter_resource_NWU_Days & 0x0000FFFF);	
	spp_sprintf(&cc_buffer, "200 frnwu:%u", temp);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;	
}
//---
int32_t			Cloud_POST_frnwu_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp1;	
	
		//
	if (sscanf(data, "POST frnwu:%lu", &temp1) == 1)
	{
		if ((temp1 <= 65535) && (temp1 > 0))
		{
			pUnit->system.ui32Filter_resource_NWU_Days = temp1;
			//set it				
			CLOUD_send_data("200 ok");			
			return save_to_NVS(pUnit);					
		}
	}
	CLOUD_send_data("400 message: Data failure");
	return BAD; 			
}
//---
int32_t			Cloud_GET_pin_reply(pUNIT pUnit)
{
	uint16_t	temp1 = (uint16_t)(pUnit->system.ui32PIN1 & 0x00007FFF);
	uint16_t	temp2 = (uint16_t)(pUnit->system.ui32PIN2 & 0x00007FFF);
	uint16_t	temp3 = (uint16_t)((pUnit->system.ui32MODE > 0) ? 1 : 0);
	
	spp_sprintf(&cc_buffer, "200 pin:mode:%u;pin1:%04u;pin2:%04u", temp3,temp1, temp2);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;		
}
//---
int32_t			Cloud_POST_pin_reply(pUNIT pUnit, char data[])
{
	uint32_t	temp1, temp2, temp3;	
	uint32_t	temp;
	if (sscanf(data, "POST pin:mode:%lu;pin1:%lu;pin2:%lu", &temp1, &temp2, &temp3) == 3)
	{
		//---
		if (temp1 == 0)
		{
			temp = 0;
		}
		else if (temp1 == 1)
		{
			temp = 0x80000000;
		}
		else
		{
			CLOUD_send_data("400 message: Data failure");
			return BAD; 
		}
		if (temp2 > 9999)
		{
			CLOUD_send_data("400 message: Data failure");
			return BAD; 
		}
		if (temp3 > 9999)
		{
			CLOUD_send_data("400 message: Data failure");
			return BAD; 
		}
		//---
		pUnit->system.ui32MODE = temp;
		pUnit->system.ui32PIN2 = temp3;
		pUnit->system.ui32PIN1 = temp2;					
		CLOUD_send_data("200 ok");
		return save_to_NVS(pUnit);						
	}
	//---
	CLOUD_send_data("400 message: Data failure");
	return BAD;	
}
//---
int32_t			Cloud_GET_sterilauto_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 sterilauto:0");	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_steriluvc_reply(pUNIT pUnit)
{	
	uint16_t	temp = check_steriluvc_mode(pUnit);	
	spp_sprintf(&cc_buffer, "200 steriluvc:%u", temp);			
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_sterilozone_reply(pUNIT pUnit)
{		
	spp_sprintf(&cc_buffer, "200 sterilozone:0");	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_filterchange_reply(pUNIT pUnit)
{	
	uint16_t	temp = (uint16_t)does_filters_to_be_changed(pUnit);
	spp_sprintf(&cc_buffer, "200 filterchange:%u", temp);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_filterleft_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 filterleft:%lu", pUnit->system.ui32FILTER_resource_left/100);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_filtertime_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 filtertime:%lu", pUnit->system.ui32FILTER_used_H);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_nwutime_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 nwutime:%lu", pUnit->system.ui32FILTER_used_NWU_H);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_firmwareversion_reply(pUNIT pUnit)
{
	spp_sprintf(&cc_buffer, "200 firmwareversion:%lu", (uint32_t)100500);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_errors_reply(pUNIT pUnit)
{
	if ((pUnit->system.ui32ERROR_code & 0xFFFFFFF8) == 0)
	{
		spp_sprintf(&cc_buffer, "200 errors:No errors");
	}
	else
	{
		spp_sprintf(&cc_buffer, "200 errors:0x%lx", pUnit->system.ui32ERROR_code);
	}
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_sterilstate_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 sterilstate:%lu", (uint32_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_ultrasonic_reply(pUNIT pUnit)
{		
	spp_sprintf(&cc_buffer, "200 ultrasonic:%lu", (uint32_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//
int32_t			Cloud_GET_consumptionambient_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 consumptionambient:%lu", pUnit->system.ui32FILTER_used_L);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_consumptioncarbon_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 consumptioncarbon:%lu", (uint32_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_consumptioncold_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 consumptioncold:%lu", (uint32_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_consumptionhot_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 consumptionhot:%lu", (uint32_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_mixer_reply(pUNIT pUnit)
{		
	spp_sprintf(&cc_buffer, "200 mixer:%u", (uint16_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_tempambient_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 tempambient:%u", (uint16_t)1);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_tempcarbon_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 tempcarbon:%u", (uint16_t)1);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_tempcold_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 tempcold:%u", (uint16_t)10);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_temphot_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 temphot:%u", (uint16_t)90);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---

//---
int32_t			Cloud_GET_hotfunction_reply(pUNIT pUnit)
{		
	spp_sprintf(&cc_buffer, "200 hotfunction:%u", (uint16_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_energysaving_reply(pUNIT pUnit)
{		
	if (pUnit->system.ui32SYSTEM_state & HW_STATE_AUTO_ON) {
		spp_sprintf(&cc_buffer, "200 energysaving:%u", (uint16_t)1);
	} else {
		spp_sprintf(&cc_buffer, "200 energysaving:%u", (uint16_t)0);
	}	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//--
int32_t			Cloud_GET_autopowerswitch_reply(pUNIT pUnit)
{		
	if (pUnit->system.ui32SYSTEM_state & HW_STATE_AUTO_ON) {
		spp_sprintf(&cc_buffer, "200 autopowerswitch:%u", (uint16_t)1);
	} else {
		spp_sprintf(&cc_buffer, "200 autopowerswitch:%u", (uint16_t)0);
	}	
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_smartfunction_reply(pUNIT pUnit)
{		
	spp_sprintf(&cc_buffer, "200 smartfunction:%u", (uint16_t)0);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_datetime_reply(pUNIT pUnit)
{	
	time_t	temp = AGE_START_POINT;
	esp_err_t err = ESP_OK;
	err =	RTC_get_time(&temp);
	if (err != ESP_OK)
	{
		ESP_LOGE("GET>", "RTC getting time failed\n");
		temp = pUnit->timeSystem_time;
	}
	spp_sprintf(&cc_buffer, "200 datetime:%llu", temp);
	CLOUD_send_data(cc_buffer);		
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_serial_reply(pUNIT pUnit)
{	
	spp_sprintf(&cc_buffer, "200 serial:%lu", pUnit->ui32ID);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_power_reply(pUNIT pUnit)
{		
	uint16_t tmp = 0;
	if (pUnit->system.ui32SYSTEM_state & HW_STATE_UNIT_ON) tmp = 1;
	spp_sprintf(&cc_buffer, "200 power:%u", (uint16_t)tmp);
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_state_reply(pUNIT pUnit)
{
	uint32_t	l;
	uint32_t	error_code = pUnit->system.ui32ERROR_code;
	//---
	l = spp_sprintf(&cc_buffer,"200 state;htanktemp:%u;", (uint16_t)100);
	//l = spp_sprintf(&cc_buffer,"200 state;htanktemp:%u;", (uint16_t)pUnit->ui32ADC_result/10); //- dummy fo no gas test
	if ((error_code & 0xFFFFFFF8) == 0)	// mask applied to ignore filter related errors
	{
		spp_sprintf(&cc_buffer[l], "errors:No errors");
	}
	else
	{
		spp_sprintf(&cc_buffer[l], "errors:0x%lx", error_code);
	}
	CLOUD_send_data(cc_buffer);
	//---
	return Cloud_CMD_good;	
	
}
//---
static uint16_t		does_filters_to_be_changed(pUNIT pUnit) {
	//---
	if (pUnit->system.ui32FILTER_resource_left == 0) {
		// filter to be changed
		return 1;
	}
	return 0;
}
//---
int32_t			Cloud_GET_all_reply(pUNIT pUnit)
{
	uint32_t	l = 0;
	uint32_t 	first;
	uint32_t	on_time, on_min, off_time, off_min;
	//---
	uint16_t	power_state = (uint16_t)(pUnit->system.ui32SYSTEM_state & HW_STATE_UNIT_ON) > 0;	// here if UNIT_ON 	
	uint16_t	smartfunction_state = 0;
	uint16_t	energysaving_state = (uint16_t)(pUnit->system.ui32SYSTEM_state & HW_STATE_AUTO_ON) > 0;	// here if AUTO is on
	uint16_t	hottank_state = (uint16_t)(pUnit->system.ui32SYSTEM_state & HW_STATE_HOT_ON) > 0; // this one depending on the ;
	uint32_t	uv_state = check_steriluvc_mode(pUnit);
	uint32_t	error_code = pUnit->system.ui32ERROR_code;	
	uint16_t	filter_change = does_filters_to_be_changed(pUnit);
	uint16_t	coldtank_state = (uint16_t)(pUnit->system.ui32SYSTEM_state & HW_STATE_COLD_ON) > 0;
	uint16_t	sys_mode = (uint16_t)(pUnit->system.ui32MODE == 0x80000000);
	esp_err_t	res;
	//uint16_t	power_state = (Unit->system.ui32SYSTEM_state & RC_SET_ON) > 0;
	//here we are limited with a number of 
	l = spp_sprintf(&cc_buffer,
		"200 all;power:%u;autopowerswitch:%u;smartfunction:%u;temphot:%u;tempambient:%u;tempcold:%u;tempcarbon:%u;\
consumptionhot:%u;serial:%lu;consumptionambient:%u;datetime:%llu;energysaving:%u;hottank:%u;lastbswap:%lu;consumptioncold:%lu;\
consumptiontotal:%lu;euvcon:%lu;euvcoff:%lu;filterchange:%u;filterleft:%lu;filtertime:%lu;nwutime:%lu;bvolume:%u;steriluvc:%u;\
coldtank:%u;ctanktemp:%u;htanktemp:%u;frdays:%u;frliters:%u;frnwu:%u;mode:%u;pin1:%04u;pin2:%04u",
		(uint16_t)power_state,
		(uint16_t)energysaving_state,		
		(uint16_t)smartfunction_state,
		(uint16_t)pUnit->system.ui32HOT_TMPRT_requested,
		(uint16_t)0,
		(uint16_t)pUnit->system.ui32COLD_TMPRT_requested,
		(uint16_t)1,
		(uint16_t)0,
		pUnit->ui32ID,
		(uint16_t)pUnit->system.ui32FILTER_used_L,
		(uint64_t)pUnit->timeSystem_time,
		energysaving_state,
		hottank_state,
		(uint32_t)pUnit->system.ui32LASTBSWAP,
		(uint32_t)0,
		(uint32_t)pUnit->system.ui32CONSUMPTION_total_L,
		(uint32_t)pUnit->system.ui32EUVC_on_reload/10,
		(uint32_t)pUnit->system.ui32EUVC_off_reload/10,
		filter_change,
		pUnit->system.ui32FILTER_resource_left/100,				// here amount of the filter resources left
		pUnit->system.ui32FILTER_used_H,					// here time since last filter replacement, in hours
		pUnit->system.ui32FILTER_used_NWU_H, 				// here time since last use, in hours
		(uint16_t)pUnit->system.ui32BOT_VOLUME,
		(uint16_t)uv_state,
		coldtank_state,
		(uint16_t)pUnit->system.ui32COLD_TMPRT_current,
		(uint16_t)pUnit->system.ui32HOT_TMPRT_current,
		(uint16_t)pUnit->system.ui32Filter_resource_Days,
		(uint16_t)pUnit->system.ui32Filter_resource_L,
		(uint16_t)pUnit->system.ui32Filter_resource_NWU_Days,
		sys_mode,
		(uint16_t)pUnit->system.ui32PIN1,
		(uint16_t)pUnit->system.ui32PIN2);
	//--- 
	first = 1;
	l = l + spp_sprintf(&cc_buffer[l], ";autopowerscheduling:");
	if (Get_WD_event_energy_saving(1, &on_time, &on_min, &off_time, &off_min))
	{
		//print it
		first = 0;
		l = l + spp_sprintf(&cc_buffer[l], "w%u,%02u:%02u,%02u:%02u", (uint16_t)1, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);				
	}
	for (uint8_t i = 2; i < 7; i++)
	{
		if (Get_WD_event_energy_saving(i, &on_time, &on_min, &off_time, &off_min))
		{
			//print it
			if (first)
			{
				first = 0;
				l = l + spp_sprintf(&cc_buffer[l], "w%u,%02u:%02u,%02u:%02u", (uint16_t)i, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);								
			}
			else
			{
				l = l + spp_sprintf(&cc_buffer[l], "|w%u,%02u:%02u,%02u:%02u", (uint16_t)i, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);					
			}			
		}
	}
	//---
	if (Get_WD_event_energy_saving(0, &on_time, &on_min, &off_time, &off_min))
	{
		//print it
		if (first)
		{
			first = 0;
			l = l + spp_sprintf(&cc_buffer[l], "w%u,%02u:%02u,%02u:%02u", (uint16_t)7, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);								
		}
		else
		{
			l = l + spp_sprintf(&cc_buffer[l], "|w%u,%02u:%02u,%02u:%02u", (uint16_t)7, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);					
		}		
	}
	//---	
	for (uint8_t i = 7; i < MAX_NUMBER_OF_ALARMS; i++)
	{
		if (Get_OD_event_energy_saving(i, &on_time, &off_time))
		{
			//print it
			if (first)
			{
				first = 0;
				l = l + spp_sprintf(&cc_buffer[l], "f%u,%lu,%lu", (uint16_t)(i - 7), on_time, off_time);				
			}
			else
			{
				l = l + spp_sprintf(&cc_buffer[l], "|f%u,%lu,%lu", (uint16_t)(i - 7), on_time, off_time);					
			}			
		}
	}		
	//--- error code ---
	if ((error_code & 0xFFFFFFF8) == 0)	// mask applied to ignore filter related errors
	{
		spp_sprintf(&cc_buffer[l], ";errors:No errors");
	}
	else
	{
		spp_sprintf(&cc_buffer[l], ";errors:0x%lx", error_code);
	}
	CLOUD_send_data(cc_buffer);
	return Cloud_CMD_good;
}
//---
int32_t			Cloud_GET_autopowerscheduling_reply(pUNIT pUnit)
{	
	// here quite complicated behavior	
	uint32_t	on_time, on_min, off_time, off_min;
	uint32_t	l,k, first = 1;
	l = spp_sprintf(&cc_buffer, "200 autopowerscheduling:");
	//---
	if (Get_WD_event_energy_saving(1, &on_time, &on_min, &off_time, &off_min))
	{
		//print it
		first = 0;
		l = l + spp_sprintf(&cc_buffer[l], "w%u,%02u:%02u,%02u:%02u", (uint16_t)1, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);				
	}
	//---
	for (uint8_t i = 2; i < 7; i++)
	{
		if (Get_WD_event_energy_saving(i, &on_time, &on_min, &off_time, &off_min))
		{
			if (first)
			{
				first = 0;
				l = l + spp_sprintf(&cc_buffer[l], "w%u,%02u:%02u,%02u:%02u", (uint16_t)i, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);				
			}
			else
			{
				l = l + spp_sprintf(&cc_buffer[l], "|w%u,%02u:%02u,%02u:%02u", (uint16_t)i, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);					
			}
			//print it			
		}
	}
	//---
	if (Get_WD_event_energy_saving(0, &on_time, &on_min, &off_time, &off_min))
	{
		if (first)
		{
			first = 0;
			l = l + spp_sprintf(&cc_buffer[l], "w%u,%02u:%02u,%02u:%02u", (uint16_t)7, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);				
		}
		else
		{
			l = l + spp_sprintf(&cc_buffer[l], "|w%u,%02u:%02u,%02u:%02u", (uint16_t)7, (uint16_t)on_time, (uint16_t)on_min, (uint16_t)off_time, (uint16_t)off_min);					
		}
		//print it
		
	}
	//--
	for (uint32_t i = 7; i < MAX_NUMBER_OF_ALARMS; i++)
	{
		if (Get_OD_event_energy_saving(i, &on_time, &off_time))
		{
			k = i-7;
			if (first)
			{
				first = 0;	
				l = l + spp_sprintf(&cc_buffer[l], "f%lu,%lu,%lu", k, on_time, off_time);				
			}
			else
			{				
				l = l + spp_sprintf(&cc_buffer[l], "|f%lu,%lu,%lu", k, on_time, off_time);					
			}
			//print it							
		}
	}
	//---
	l = l + spp_sprintf(&cc_buffer[l], ";");				
	//---
	CLOUD_send_data(cc_buffer);	
	return Cloud_CMD_good;
}

//---
int32_t			Cloud_POST_autopowerscheduling_reply(pUNIT pUnit, char data[])
{	
	uint32_t	l = 25;
	uint32_t	exit_allowed = 0;
	uint32_t	i = 0;
	uint32_t	error = 0;
	uint32_t	fld1, fld2, fld3, fld4, fld5;	
	//---	
	reset_RAM_energy_saving_data();	
	//---
	while (!(exit_allowed)) 
	{
		//here delay
		if (sscanf((char*)&data[l], "w%lu,%lu:%lu,%lu:%lu", &fld1, &fld2, &fld3, &fld4, &fld5) == 5)
		{			
			if (((fld1 <= 7) && (fld1 > 0)) &&
				(fld2 <= 23) &&
				(fld3 <= 59) &&
				(fld4 <= 23) &&
				(fld5 <= 59))
			{							
				if (WD_event_set_energy_saving((uint8_t)fld1, (uint8_t)fld2, (uint8_t)fld3, (uint8_t)fld4, (uint8_t)fld5) == ESP_OK)
				{
					ESP_LOGI("SCHD_PWR>", "WD event added - w%lu,%lu:%lu,%lu:%lu", fld1, fld2, fld3, fld4, fld5);
				}				
			}
			else { error = 1; }
		}
		else if (sscanf((char*)&data[l], "f%lu,%lu,%lu", &fld1, &fld2, &fld3) == 3)
		{											
			if (((fld1 <= 32)) &&
				(fld2 > AGE_START_POINT) &&
				(fld3 > AGE_START_POINT))
			{											
				if (OD_event_set_energy_saving((uint8_t)fld1, fld2, fld3) == ESP_OK)
				{
					ESP_LOGI("SCHD_PWR>", "OD event added - f%lu,%lu,%lu", fld1, fld2, fld3);
				}				
			}
			else {	error = 1; }			
		}			
		else 
		{ 
			if (data[l] != ';')
			{
				error = 1; 	
			}	 
		}
		//if no errors, should shift start position till next ';'
		if(error == 0)
		{
			i = l;
			while ((data[i] != '|') && (data[i] != ';') && (data[i] != (char)0) && (i < SPP_DATA_BUFF_MAX_LEN))
			{
				i++;
			}
			if ((i < (SPP_DATA_BUFF_MAX_LEN - 1)) && ((data[i] == ';') || (data[i] == '|')) && (data[i + 1] != (char)0))
			{
				l = i + 1;				
			}
			else { exit_allowed = 1; }			
		}
		else { exit_allowed = 1; }
	}
	if (error == 0)
	{		
		save_RAM_data();
		CLOUD_send_data("200 ok");	
		return Cloud_CMD_good;
	}
	else
	{
		CLOUD_send_data("400 message: Data failure");
		load_RAM_data();
	}
	return Cloud_CMD_bad;
}

	
	