#include "stdio.h"
#include <time.h>
#ifndef UNIT_H
#define UNIT_H
//---
#define	not_SS_BOT_DOWN_CHA
#define not_SS_BOT_DOWN_CHS
#define not_SS_BOT_UP_CHA
#define not_SS_BOT_UP_CHS
#define SS_PIPE_CHA
#define not_SS_PIPE_CHS
#define	COLOR_WHITE
#define not_COLOR_BLACK
//---
#define 		GPIO_RTC_CE						10
#define 		GPIO_RTC_SCLK					7
#define 		GPIO_RTC_SDAT  					6
#define 		GPIO_GAS_SENSE					NOT KNOWN	 // question about this implementation?
#define 		UART_SYS_TXD					21							
#define 		UART_SYS_RXD					20
#define 		UART_DEBUG_TXD					18
#define 		UART_DEBUG_RXD					19
//---
#define			SYS_UART_MAX					4096
//
#define			POST_POWER_ON					0x00000001
#define			POST_POWER_OFF					0x00000000
#define			STERIL_ON						0x00000001
#define			STERIL_OFF						0x00000000
#define			POST_ON							0x00000001
#define			POST_OFF						0x00000000
//---
#define			Cloud_CMD_good					0
#define			Cloud_CMD_bad					-1
#define			Cloud_CMD_timeout				-2
//---
#define			KEEP_ALIVE_ALLOWED				((uint32_t)1 << 0)
#define			CLOUD_CONNECTED					((uint32_t)1 << 1)
#define			SYS_TICK_100ms					((uint32_t)1 << 31)
//---
#define			HB_RELOAD						100	//10 sec
//---
#define 		HW_STATE_UNIT_ON				((uint32_t)1 << 0)	// this bit dispaly if heating and cooling are on
#define			HW_STATE_UV_EXTRA_ON			((uint32_t)1 << 1)	// this bit display actual operational state of the additional UVC
#define 		HW_STATE_COLD_ON				((uint32_t)1 << 2)	// this bit display actual operational state of the cooler
#define 		HW_STATE_HOT_ON					((uint32_t)1 << 3)	// this bit display actual operational state of the heater
#define 		HW_STATE_HOT_ENABLE				((uint32_t)1 << 4)	// this bit define if heater operation is enabled at all
#define		    HW_STATE_COLD_ENABLE			((uint32_t)1 << 5)  // this bit define if cooler operation is enabled at all
#define			STATE_HOT_PUSHED				((uint32_t)1 << 6)  // this bit define if we are expecting reply on PUSH command
#define			STATE_COLD_PUSHED				((uint32_t)1 << 7)  // this bit define if we are expecting reply on PUSH command
#define 		HW_STATE_BOT_PRESENT			((uint32_t)1 << 8)	// this bit defines if bottle is installed
//--- HW_NV thershold
#define 		HW_STATE_AUTO_ON				((uint32_t)1 << 12)	// this bit allows operation of the power sheduling
#define 		HW_STATE_UV_EXTRA_ENABLED		((uint32_t)1 << 13)	//this bit allows operation of the EUVC

// with this masks defines the registers to be saved
#define 		HW_STATE_NV_MASK				(HW_STATE_AUTO_ON |  HW_STATE_UV_EXTRA_ENABLED)

//#define			MAX_NUMBER_OF_SCHDULES			33
//#define			UNIT_ON_GPIO_CONFIRMED			((uint32_t)1 << 0)
//#define			DISPENSE_ON_GPIO_CONFIRMED		((uint32_t)1 << 1)
//---
#define			DEFAULT_FILTER_RESOURCE_DAYS	365
#define			DEFAULT_FILTER_RESOURCE_LITERS	25000
#define			DEFAULT_FILTER_NWU_DAYS			21
#define			DEFAULT_PIN1					1234
#define			DEFAULT_PIN2					4321
#define			AGE_START_POINT					1774427757
#define			DEFAULT_ID						0x12345678 				//--- here we have default HW configuration bits
#define			HOUR_TIMER_RELOAD				36000					//--- sysem ticks in one hour
#define			SEC_TIMER_RELOAD				10						//--- system ticks in one secodn
#define			TICK_to_mL_rate					2						//--- 2 ticks for 1 mL of water
#define			BUVC_on_time					12000					// basic UVC on time - 20 min
#define 		BUVC_off_time					36000					// basic UVV off time - 60 min
#define 		EUVC_on_default					15000					// extra UVC on time
#define 		EUVC_off_default				(36000-EUVC_on_default)	// extra UVC off time
#define			CO2_NO_GAS_THR					200						// no GAS level
#define			CO2_GAS_ENOUGH_THR				700						// GAS present
//---
#define	mode_bit0															((uint32_t)1 << 0)
#define	mode_bit1															((uint32_t)1 << 1)
#define	mode_bit2															((uint32_t)1 << 2)
#define mode_mask															(mode_bit0 | mode_bit1 | mode_bit2)
//internal SC config bits
#define sc_uv_mode0															((uint32_t)1 << 3)
#define sc_uv_mode1															((uint32_t)1 << 4)
#define sc_uv_mask															(sc_uv_mode0 | sc_uv_mode1)
//
#define FILTER_MAX_LEVEL_ERROR												((uint32_t)1 << 1)										
#define FILTR_NWU_REACHED_ERROR												((uint32_t)1 << 2)
#define CO2_NO_GAS_ERROR													((uint32_t)1 << 3)

//---
typedef struct
{
	//UART_HandleTypeDef	*huart;
	uint32_t			ui32TX_Timeout;
	uint32_t			ui32CMD_Timeout;
	//char				chRxBuff[SYS_UART_MAX];
	//char				chTxBuff[SYS_UART_MAX];
	//char				chRXed_Data_Buff[SYS_UART_MAX];

	//tCQueue				RX_queue;
	uint32_t			RxCounter;
	uint32_t			RxDataCounter;
	uint32_t			BuffCounter;
	uint32_t			TxCounter;
	char				chBUFF_UART;
} tUART_COMM_channel;
//---
typedef tUART_COMM_channel * pUART_COMM_channel;
//---
typedef enum
{
	NOT_PRESENT = 0,
	TO_START = 1,
	STARTED = 2,
	TO_FINISH = 3,	
	FINISHED = 4,
	ERROR_REMOVE = 5,
	ERROR_TIMEOUT = 6
} tEvent_status;
//---
typedef enum
{
	Just_on	= 0,
	Identifying = 1,
	StandBy = 2,
	Requesting_time = 3,	
} tSystem_state;
//---

typedef struct
{			
	//uint32_t	ui32COUNTER_ticks;				//--- here we have water counter ticks strored, this one should be updated in interrupt
	//uint32_t	ui32TICKs_to_mL_rate;			//--- here we are going to have conversion rate from ticks to mL
	uint32_t	ui32WATER_consumption_L;		//--- here we have water consumption in liters, scince last filter reset
	uint32_t	ui32FILTER_resource_left;		//--- here we have filter resource inidcation in 100* by percents 0-100%
	//--- filter resources 
	uint32_t	ui32Filter_resource_L;
	uint32_t	ui32Filter_resource_Days;
	uint32_t	ui32Filter_resource_NWU_Days;
	time_t		ui32FILTER_reset_POSIX_time;
	//----	
	uint32_t	ui32FILTER_used_L;				//--- here basically copy of the water consumption in litters		
	uint32_t	ui32FILTER_used_H;				//--- here time passed since last filter replacement in hours
	uint32_t	ui32FILTER_used_NWU_H;			//--- here time passed, since there was water flow last time	
	//---	
	uint32_t	ui32ERROR_code;
	//---	
	uint32_t	ui32PIN1;						//--- PINs to be set to default and not changed
	uint32_t	ui32PIN2;						//
	uint32_t	ui32MODE;						//
	//---
	uint32_t	ui32SYSTEM_state;;
	//---
	uint32_t	ui32EUVC_timer;					// timer for the extra UVC operation, here 0x80000000 on, 0x0000000 off, other values are reload values in 100ms ticks
	uint32_t	ui32EUVC_on_reload;
	uint32_t	ui32EUVC_off_reload;
	//---
	uint32_t	ui32BOT_VOLUME;
	uint32_t	ui32LASTBSWAP;
	uint32_t	ui32CONSUMPTION_total_L;			// total amout of water consumed in mL, == ui32WATER_consumption_L + ui32CONSUMPTION_SAVED;
	uint32_t	ui32CONSUMPTION_SAVED;				// this register represents counter value, == ui32CONSUMPTION_total_L, when saved to NVS
	//---
	uint32_t	ui32COLD_TMPRT_current;
	uint32_t	ui32COLD_TMPRT_requested;
	uint32_t	ui32HOT_TMPRT_current;
	uint32_t	ui32HOT_TMPRT_requested;
} tSYS_DATA;
typedef struct
{
	uint32_t			ui32ID;
	char				name[23];
	uint32_t			ui32State;
	uint32_t			ui32HOUR_timer;
	uint32_t			ui32SEC_timer;				//--- here we have flags for the unit state
	uint32_t			ui32HBTimer;
	tSYS_DATA			system;
	//tSystem_state		SM;
	time_t				timeSystem_time;
	uint32_t			ui32HW_configuration;
	char				Line_Terminator0;
	char				Line_Terminator1;
	uint32_t			ui32ADC_result;
} tUNIT;
typedef tUNIT * pUNIT;
///
int32_t			init_unit(void);
uint32_t		cyclic_complete();
int32_t			cyclic_init();
uint32_t		Cloud_cmd_extractor(pUNIT Unit);
int				COM_MODULE_on(pUNIT Unit);
int				prepare_MODULE(pUNIT Unit);
int				Start_IP_communications(pUNIT Unit);
int				Start_server_communications(pUNIT Unit);
int				identify_unit(pUNIT Unit);
int32_t			Cloud_GET_all_reply(pUNIT pUnit);
int				request_time(pUNIT Unit);


uint32_t		System_data_extractor(pUNIT Unit);
//int32_t			CLOUD_get_reply(pxE310 pModule, char data[]);
//int32_t			CLOUD_reply_waiting(pxE310 pModule);
int32_t			CLOUD_process_CMD(pUNIT pUnit, char * data);
int32_t			UNIT_data_process(pUNIT pUnit, char * data);
int32_t			Cloud_GET_serial_reply(pUNIT pUnit);
int32_t			Cloud_GET_datetime_reply(pUNIT pUnit);
int32_t			Cloud_GET_smartfunction_reply(pUNIT pUnit);
int32_t			Cloud_GET_energysaving_reply(pUNIT pUnit);
int32_t			Cloud_GET_hotfunction_reply(pUNIT pUnit);
int32_t			Cloud_GET_childsafety_reply(pUNIT pUnit);
int32_t			Cloud_GET_mixer_reply(pUNIT pUnit);
int32_t			Cloud_GET_tempambient_reply(pUNIT pUnit);
int32_t			Cloud_GET_tempcarbon_reply(pUNIT pUnit);
int32_t			Cloud_GET_tempcold_reply(pUNIT pUnit);
int32_t			Cloud_GET_temphot_reply(pUNIT pUnit);
int32_t			Cloud_GET_consumptionambient_reply(pUNIT pUnit);
int32_t			Cloud_GET_consumptioncarbon_reply(pUNIT pUnit);
int32_t			Cloud_GET_consumptioncold_reply(pUNIT pUnit);
int32_t			Cloud_GET_consumptionhot_reply(pUNIT pUnit);
int32_t			Cloud_GET_power_reply(pUNIT pUnit);
int32_t			Cloud_GET_ultrasonic_reply(pUNIT pUnit);
int32_t			Cloud_GET_ultrasonicsens_reply(pUNIT pUnit);
int32_t			Cloud_GET_sterilstate_reply(pUNIT pUnit);
int32_t			Cloud_GET_errors_reply(pUNIT pUnit);
int32_t			Cloud_GET_filterchange_reply(pUNIT pUnit);
int32_t			Cloud_GET_filterleft_reply(pUNIT pUnit);
int32_t			Cloud_GET_filterlastchange_reply(pUNIT pUnit);
int32_t			Cloud_GET_sterilauto_reply(pUNIT pUnit);
int32_t			Cloud_GET_steriluvc_reply(pUNIT pUnit);
int32_t			Cloud_GET_sterilozone_reply(pUNIT pUnit);
int32_t			Cloud_GET_autopowerscheduling_reply(pUNIT pUnit);
int32_t			Cloud_GET_autopowerswitch_reply(pUNIT pUnit);
//---
int32_t			Cloud_POST_power_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_smartfunction_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_energysaving_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_hotfunction_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_childsafety_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_ultrasonicsens_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_ultrasonic_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_tempcarbon_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_tempcold_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_tempambient_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_temphot_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_sterilstate_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_filterreset_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_sterilauto_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_steriluvc_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_sterilozone_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_filterchange_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_errorsreset_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_restart_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_autopowerscheduling_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_autopowerswitch_reply(pUNIT pUnit, char data[]);	
int32_t			Cloud_POST_dispense_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_cdispense_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_htanktemp_reply(pUNIT pUnit);
uint32_t		CT_control_process(void);
int32_t			UNIT_send_data(pUNIT pUnit);
int32_t			UNIT_transmit_data(pUNIT pUnit, const char * data);
int32_t			init_bt_adv_data(uint8_t  data[]);
int32_t			Cloud_POST_datetime_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_sterilscheduling_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_sterilscheduling_reply(pUNIT pUnit);
int32_t			Cloud_POST_factoryreset_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_frliters_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_frdays_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_frdays_reply(pUNIT pUnit);
int32_t			Cloud_GET_frliters_reply(pUNIT pUnit);
int32_t			Cloud_GET_state_reply(pUNIT pUnit);
int32_t			Cloud_POST_serial_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_pin_reply(pUNIT pUnit);
int32_t			Cloud_POST_pin_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_frnwu_reply(pUNIT pUnit);
int32_t			Cloud_POST_frnwu_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_filtertime_reply(pUNIT pUnit);
int32_t			Cloud_GET_nwutime_reply(pUNIT pUnit);
int32_t			Cloud_GET_firmwareversion_reply(pUNIT pUnit);
int32_t			Cloud_GET_EUVC_ON_reply(pUNIT pUnit);
int32_t			Cloud_GET_EUVC_OFF_reply(pUNIT pUnit);
int32_t			Cloud_POST_EUVC_OFF_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_EUVC_ON_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_POST_bvolume_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_bvolume_reply(pUNIT pUnit);
int32_t			Cloud_POST_coldtank_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_coldtank_reply(pUNIT pUnit);
int32_t			Cloud_POST_hottank_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_hottank_reply(pUNIT pUnit);
int32_t			Cloud_POST_lastbswap_reply(pUNIT pUnit, char data[]);
int32_t			Cloud_GET_lastbswap_reply(pUNIT pUnit);
int32_t			Cloud_GET_consumptiontotal_reply(pUNIT pUnit);
//---
void			UNIT_reset_WCS(void);
#endif
