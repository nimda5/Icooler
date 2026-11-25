/*
   This example code is in the Public Domain (or CC0 licensed, at your option.)

   Unless required by applicable law or agreed to in writing, this
   software is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
   CONDITIONS OF ANY KIND, either express or implied.
*/

//--- for the test purposes
#define not_SYS_DISABLE_HB_DISCONNECT



//--- keep connected

//

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "esp_bt.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "string.h"
#include "esp_adc/adc_oneshot.h"

#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_bt_defs.h"
#include "esp_bt_main.h"
#include "main.h"
#include "unit.h"
#include "auxilary_devices.h"
#include "basic_queue.h"

//---
//#define GPIO_OUTPUT_RES0                10
//#define GPIO_OUTPUT_DISPENSE_ALLOWED    19
//#define GPIO_OUTPUT_RC                  18
//#define GPIO_MCU_TXD                    5
//#define GPIO_MCU_RXD                    3



#define SPP_PROFILE_NUM             1
#define SPP_PROFILE_APP_IDX         0
#define ESP_SPP_APP_ID              0x56
#define SAMPLE_DEVICE_NAME          "CTP-BL-CHS-V05"    //The Device Name Characteristics in GAP
#define SPP_SVC_INST_ID	            0
#define DEBUG_OUTPUT
/// SPP Service
static const uint16_t spp_service_uuid = 0xABF0;
/// Characteristic UUID
#define ESP_GATT_UUID_SPP_DATA_RECEIVE      0xABF1
#define ESP_GATT_UUID_SPP_DATA_NOTIFY       0xABF2
#define ESP_GATT_UUID_SPP_COMMAND_RECEIVE   0xABF3
#define ESP_GATT_UUID_SPP_COMMAND_NOTIFY    0xABF4

#ifdef SUPPORT_HEARTBEAT
#define ESP_GATT_UUID_SPP_HEARTBEAT         0xABF5
#endif

static uint8_t spp_adv_data[23];// = {
    /* Flags */
    //0x02,0x01,0x06,
    /* Complete List of 16-bit Service Class UUIDs */
    //0x03,0x03,0xF0,0xAB,
    /* Complete Local Name in advertising */
    //0x0F,0x09, 'C', 'T', 'P', '-', 'B', 'L', '-','C','H','A','-','V','0','5'
//};

static uint16_t 			spp_mtu_size = 23;
static uint16_t 			spp_conn_id = 0xffff;
static esp_gatt_if_t 		spp_gatts_if = 0xff;
QueueHandle_t   			spp_uart_queue = NULL;
QueueHandle_t   			sys_uart_queue = NULL;
static QueueHandle_t     	cmd_cmd_queue = NULL;
static QueueHandle_t     	system_queue = NULL;
tBasicQ						CC_input_queue;
QueueHandle_t				CC_output_queue = NULL;
QueueHandle_t				UNIT_input_queue = NULL;
QueueHandle_t				UNIT_output_queue = NULL;
tUNIT           			SIG_unit;
adc_oneshot_unit_handle_t 	adc1_handle;

#ifdef SUPPORT_HEARTBEAT
static QueueHandle_t cmd_heartbeat_queue = NULL;
static uint8_t  heartbeat_s[9] = {'E','s','p','r','e','s','s','i','f'};
static bool enable_heart_ntf = false;
static uint8_t heartbeat_count_num = 0;
#endif

static bool enable_data_ntf = false;
static bool is_connected = false;
static esp_bd_addr_t spp_remote_bda = {0x0,};

static uint16_t spp_handle_table[SPP_IDX_NB];

static esp_ble_adv_params_t spp_adv_params = {
    .adv_int_min        = 0x20,
    .adv_int_max        = 0x40,
    .adv_type           = ADV_TYPE_IND,
    .own_addr_type      = BLE_ADDR_TYPE_PUBLIC,
    .channel_map        = ADV_CHNL_ALL,
    .adv_filter_policy  = ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY,
};

struct gatts_profile_inst {
    esp_gatts_cb_t gatts_cb;
    uint16_t gatts_if;
    uint16_t app_id;
    uint16_t conn_id;
    uint16_t service_handle;
    esp_gatt_srvc_id_t service_id;
    uint16_t char_handle;
    esp_bt_uuid_t char_uuid;
    esp_gatt_perm_t perm;
    esp_gatt_char_prop_t property;
    uint16_t descr_handle;
    esp_bt_uuid_t descr_uuid;
};

typedef struct spp_receive_data_node{
    int32_t len;
    uint8_t * node_buff;
    struct spp_receive_data_node * next_node;
}spp_receive_data_node_t;

static spp_receive_data_node_t * temp_spp_recv_data_node_p1 = NULL;
static spp_receive_data_node_t * temp_spp_recv_data_node_p2 = NULL;

typedef struct spp_receive_data_buff{
    int32_t node_num;
    int32_t buff_size;
    spp_receive_data_node_t * first_node;
}spp_receive_data_buff_t;

static spp_receive_data_buff_t SppRecvDataBuff = {
    .node_num   = 0,
    .buff_size  = 0,
    .first_node = NULL
};

static void gatts_profile_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param);

/* One gatt-based profile one app_id and one gatts_if, this array will store the gatts_if returned by ESP_GATTS_REG_EVT */
static struct gatts_profile_inst spp_profile_tab[SPP_PROFILE_NUM] = {
    [SPP_PROFILE_APP_IDX] = {
        .gatts_cb = gatts_profile_event_handler,
        .gatts_if = ESP_GATT_IF_NONE,       /* Not get the gatt_if, so initial is ESP_GATT_IF_NONE */
    },
};

/*
 *  SPP PROFILE ATTRIBUTES
 ****************************************************************************************
 */

#define CHAR_DECLARATION_SIZE   (sizeof(uint8_t))
static const uint16_t primary_service_uuid = ESP_GATT_UUID_PRI_SERVICE;
static const uint16_t character_declaration_uuid = ESP_GATT_UUID_CHAR_DECLARE;
static const uint16_t character_client_config_uuid = ESP_GATT_UUID_CHAR_CLIENT_CONFIG;

static const uint8_t char_prop_read_notify = ESP_GATT_CHAR_PROP_BIT_READ|ESP_GATT_CHAR_PROP_BIT_NOTIFY;
static const uint8_t char_prop_read_write = ESP_GATT_CHAR_PROP_BIT_WRITE_NR|ESP_GATT_CHAR_PROP_BIT_READ;

#ifdef SUPPORT_HEARTBEAT
static const uint8_t char_prop_read_write_notify = ESP_GATT_CHAR_PROP_BIT_READ|ESP_GATT_CHAR_PROP_BIT_WRITE_NR|ESP_GATT_CHAR_PROP_BIT_NOTIFY;
#endif

///SPP Service - data receive characteristic, read&write without response
static const uint16_t spp_data_receive_uuid = ESP_GATT_UUID_SPP_DATA_RECEIVE;
static const uint8_t  spp_data_receive_val[20] = {0x00};

///SPP Service - data notify characteristic, notify&read
static const uint16_t spp_data_notify_uuid = ESP_GATT_UUID_SPP_DATA_NOTIFY;
static const uint8_t  spp_data_notify_val[20] = {0x00};
static const uint8_t  spp_data_notify_ccc[2] = {0x00, 0x00};

///SPP Service - command characteristic, read&write without response
static const uint16_t spp_command_uuid = ESP_GATT_UUID_SPP_COMMAND_RECEIVE;
static const uint8_t  spp_command_val[10] = {0x00};

///SPP Service - status characteristic, notify&read
static const uint16_t spp_status_uuid = ESP_GATT_UUID_SPP_COMMAND_NOTIFY;
static const uint8_t  spp_status_val[10] = {0x00};
static const uint8_t  spp_status_ccc[2] = {0x00, 0x00};

#ifdef SUPPORT_HEARTBEAT
///SPP Server - Heart beat characteristic, notify&write&read
static const uint16_t spp_heart_beat_uuid = ESP_GATT_UUID_SPP_HEARTBEAT;
static const uint8_t  spp_heart_beat_val[2] = {0x00, 0x00};
static const uint8_t  spp_heart_beat_ccc[2] = {0x00, 0x00};
#endif

///Full HRS Database Description - Used to add attributes into the database
static const esp_gatts_attr_db_t spp_gatt_db[SPP_IDX_NB] =
{
    //SPP -  Service Declaration
    [SPP_IDX_SVC]                      	=
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&primary_service_uuid, ESP_GATT_PERM_READ,
    sizeof(spp_service_uuid), sizeof(spp_service_uuid), (uint8_t *)&spp_service_uuid}},

    //SPP -  data receive characteristic Declaration
    [SPP_IDX_SPP_DATA_RECV_CHAR]            =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_declaration_uuid, ESP_GATT_PERM_READ,
    CHAR_DECLARATION_SIZE,CHAR_DECLARATION_SIZE, (uint8_t *)&char_prop_read_write}},

    //SPP -  data receive characteristic Value
    [SPP_IDX_SPP_DATA_RECV_VAL]             	=
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&spp_data_receive_uuid, ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,
    SPP_DATA_MAX_LEN,sizeof(spp_data_receive_val), (uint8_t *)spp_data_receive_val}},

    //SPP -  data notify characteristic Declaration
    [SPP_IDX_SPP_DATA_NOTIFY_CHAR]  =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_declaration_uuid, ESP_GATT_PERM_READ,
    CHAR_DECLARATION_SIZE,CHAR_DECLARATION_SIZE, (uint8_t *)&char_prop_read_notify}},

    //SPP -  data notify characteristic Value
    [SPP_IDX_SPP_DATA_NTY_VAL]   =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&spp_data_notify_uuid, ESP_GATT_PERM_READ,
    SPP_DATA_MAX_LEN, sizeof(spp_data_notify_val), (uint8_t *)spp_data_notify_val}},

    //SPP -  data notify characteristic - Client Characteristic Configuration Descriptor
    [SPP_IDX_SPP_DATA_NTF_CFG]         =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_client_config_uuid, ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,
    sizeof(uint16_t),sizeof(spp_data_notify_ccc), (uint8_t *)spp_data_notify_ccc}},

    //SPP -  command characteristic Declaration
    [SPP_IDX_SPP_COMMAND_CHAR]            =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_declaration_uuid, ESP_GATT_PERM_READ,
    CHAR_DECLARATION_SIZE,CHAR_DECLARATION_SIZE, (uint8_t *)&char_prop_read_write}},

    //SPP -  command characteristic Value
    [SPP_IDX_SPP_COMMAND_VAL]                 =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&spp_command_uuid, ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,
    SPP_CMD_MAX_LEN,sizeof(spp_command_val), (uint8_t *)spp_command_val}},

    //SPP -  status characteristic Declaration
    [SPP_IDX_SPP_STATUS_CHAR]            =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_declaration_uuid, ESP_GATT_PERM_READ,
    CHAR_DECLARATION_SIZE,CHAR_DECLARATION_SIZE, (uint8_t *)&char_prop_read_notify}},

    //SPP -  status characteristic Value
    [SPP_IDX_SPP_STATUS_VAL]                 =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&spp_status_uuid, ESP_GATT_PERM_READ,
    SPP_STATUS_MAX_LEN,sizeof(spp_status_val), (uint8_t *)spp_status_val}},

    //SPP -  status characteristic - Client Characteristic Configuration Descriptor
    [SPP_IDX_SPP_STATUS_CFG]         =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_client_config_uuid, ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,
    sizeof(uint16_t),sizeof(spp_status_ccc), (uint8_t *)spp_status_ccc}},

#ifdef SUPPORT_HEARTBEAT
    //SPP -  Heart beat characteristic Declaration
    [SPP_IDX_SPP_HEARTBEAT_CHAR]  =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_declaration_uuid, ESP_GATT_PERM_READ,
    CHAR_DECLARATION_SIZE,CHAR_DECLARATION_SIZE, (uint8_t *)&char_prop_read_write_notify}},

    //SPP -  Heart beat characteristic Value
    [SPP_IDX_SPP_HEARTBEAT_VAL]   =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&spp_heart_beat_uuid, ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,
    sizeof(spp_heart_beat_val), sizeof(spp_heart_beat_val), (uint8_t *)spp_heart_beat_val}},

    //SPP -  Heart beat characteristic - Client Characteristic Configuration Descriptor
    [SPP_IDX_SPP_HEARTBEAT_CFG]         =
    {{ESP_GATT_AUTO_RSP}, {ESP_UUID_LEN_16, (uint8_t *)&character_client_config_uuid, ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,
    sizeof(uint16_t),sizeof(spp_data_notify_ccc), (uint8_t *)spp_heart_beat_ccc}},
#endif
};
/*
 *What does this doingg?
*/
static uint8_t find_char_and_desr_index(uint16_t handle)
{
    uint8_t error = 0xff;

    for(int i = 0; i < SPP_IDX_NB ; i++)
    {
        if(handle == spp_handle_table[i])
        {
            return i;
        }
    }
    return error;
}
/*
 *What does this doingg?
*/
uint32_t    BLE_send(char * data);
static bool store_wr_buffer(esp_ble_gatts_cb_param_t *p_data)
{
    temp_spp_recv_data_node_p1 = (spp_receive_data_node_t *)malloc(sizeof(spp_receive_data_node_t));

    if(temp_spp_recv_data_node_p1 == NULL)
    {   
        ESP_LOGE(GATTS_TABLE_TAG, "malloc error %s %d\n", __func__, __LINE__);
        return false;
    }
    if(temp_spp_recv_data_node_p2 != NULL)
    {
        temp_spp_recv_data_node_p2->next_node = temp_spp_recv_data_node_p1;
    }
    temp_spp_recv_data_node_p1->len = p_data->write.len;
    SppRecvDataBuff.buff_size += p_data->write.len;
    temp_spp_recv_data_node_p1->next_node = NULL;
    temp_spp_recv_data_node_p1->node_buff = (uint8_t *)malloc(p_data->write.len);
    temp_spp_recv_data_node_p2 = temp_spp_recv_data_node_p1;
    memcpy(temp_spp_recv_data_node_p1->node_buff,p_data->write.value,p_data->write.len);
    if(SppRecvDataBuff.node_num == 0)
    {
        SppRecvDataBuff.first_node = temp_spp_recv_data_node_p1;
        SppRecvDataBuff.node_num++;
    }
	else
	{
        SppRecvDataBuff.node_num++;
    }
    return true;
}
/*
 *What does this doingg?
*/
static void free_write_buffer(void)
{
    temp_spp_recv_data_node_p1 = SppRecvDataBuff.first_node;

    while(temp_spp_recv_data_node_p1 != NULL)
    {
        temp_spp_recv_data_node_p2 = temp_spp_recv_data_node_p1->next_node;
        free(temp_spp_recv_data_node_p1->node_buff);
        free(temp_spp_recv_data_node_p1);
        temp_spp_recv_data_node_p1 = temp_spp_recv_data_node_p2;
    }

    SppRecvDataBuff.node_num = 0;
    SppRecvDataBuff.buff_size = 0;
    SppRecvDataBuff.first_node = NULL;
}
/*
 *What does this doingg?
*/
static void print_write_buffer(void)
{    
	//here first estimate full length of recieved data
	//put all data in the memory and add to sysem_queue
	//after print to uart as it is
	uint32_t    temp_local = 0;
	uint8_t * buffer;
	temp_spp_recv_data_node_p1 = SppRecvDataBuff.first_node;
	while (temp_spp_recv_data_node_p1 != NULL)
	{
		//uart_write_bytes(UART_NUM_0, (char *)(temp_spp_recv_data_node_p1->node_buff), temp_spp_recv_data_node_p1->len);
		temp_local += temp_spp_recv_data_node_p1->len;
		temp_spp_recv_data_node_p1 = temp_spp_recv_data_node_p1->next_node;
	}
	//next memalloc
	buffer = (uint8_t *)malloc(temp_local+1);	
	if (buffer == NULL)
	{
		//here error
	}
	temp_local = 0;
	temp_spp_recv_data_node_p1 = SppRecvDataBuff.first_node;
    while(temp_spp_recv_data_node_p1 != NULL)
    {
        //uart_write_bytes(UART_NUM_0, (char *)(temp_spp_recv_data_node_p1->node_buff), temp_spp_recv_data_node_p1->len);
	    memcpy((char*)buffer[temp_local],(char*)temp_spp_recv_data_node_p1->node_buff, temp_spp_recv_data_node_p1->len);
	    temp_local += temp_spp_recv_data_node_p1->len;
        temp_spp_recv_data_node_p1 = temp_spp_recv_data_node_p1->next_node;
    }
	//here add to queue
	buffer[temp_local] = (char)0;	
	xQueueSend(system_queue, &buffer, 0);
}
/*
 *What does this doingg?
*/
uint32_t    BLE_send(char * data)
{
	uint8_t *   temp = NULL;
	uint8_t *   ntf_value_p = NULL;
	uint32_t    data_size = strlen(data);
	uint8_t     total_num = 0;
	uint8_t     current_num = 0;
	//in data we having string to send
	if((data_size)&&(is_connected)) 
	{		
#ifdef SUPPORT_HEARTBEAT
		if (!enable_heart_ntf)
		{
			ESP_LOGE(GATTS_TABLE_TAG, "%s do not enable heartbeat Notify\n", __func__);
			break;
		}
#endif
		if (!enable_data_ntf)
		{
			ESP_LOGE(GATTS_TABLE_TAG, "%s do not enable data Notify\n", __func__);                  
			return BAD;
		}
		temp = (uint8_t *)malloc(sizeof(uint8_t)*data_size);
		if (temp == NULL)
		{                 
			ESP_LOGE(GATTS_TABLE_TAG, "%s malloc.1 failed\n", __func__);	                    
			return BAD;
		}
		memset(temp, 0x0, data_size);   //filling area with 0x00
		memcpy(temp, data, data_size);
		if (data_size <= (spp_mtu_size - 3))
		{
			//following function implements sending of data
			esp_ble_gatts_send_indicate(spp_gatts_if, spp_conn_id, spp_handle_table[SPP_IDX_SPP_DATA_NTY_VAL], data_size, temp, false);
		}
		else if (data_size > (spp_mtu_size - 3))
		{
			if ((data_size % (spp_mtu_size - 7)) == 0)
			{
				total_num = data_size / (spp_mtu_size - 7);
			}
			else
			{
				total_num = data_size / (spp_mtu_size - 7) + 1;
			}
			current_num = 1;
			ntf_value_p = (uint8_t *)malloc((spp_mtu_size - 3)*sizeof(uint8_t));
			if (ntf_value_p == NULL)
			{	                        
				ESP_LOGE(GATTS_TABLE_TAG, "%s malloc.2 failed\n", __func__);
				free(temp);
				return BAD;
			}
			while (current_num <= total_num)
			{
				if (current_num < total_num)
				{
					ntf_value_p[0] = '#';
					ntf_value_p[1] = '#';
					ntf_value_p[2] = total_num;
					ntf_value_p[3] = current_num;
					memcpy(ntf_value_p + 4, temp + (current_num - 1)*(spp_mtu_size - 7), (spp_mtu_size - 7));
					esp_ble_gatts_send_indicate(spp_gatts_if, spp_conn_id, spp_handle_table[SPP_IDX_SPP_DATA_NTY_VAL], (spp_mtu_size - 3), ntf_value_p, false);
				}
				else if (current_num == total_num)
				{
					ntf_value_p[0] = '#';
					ntf_value_p[1] = '#';
					ntf_value_p[2] = total_num;
					ntf_value_p[3] = current_num;
					memcpy(ntf_value_p + 4, temp + (current_num - 1)*(spp_mtu_size - 7), (data_size - (current_num - 1)*(spp_mtu_size - 7)));
					esp_ble_gatts_send_indicate(spp_gatts_if, spp_conn_id, spp_handle_table[SPP_IDX_SPP_DATA_NTY_VAL], (data_size - (current_num - 1)*(spp_mtu_size - 7) + 4), ntf_value_p, false);
				}
				vTaskDelay(20 / portTICK_PERIOD_MS);
				current_num++;
			}
			free(ntf_value_p);
		}
		free(temp);
		return GOOD;
	}
	return BAD;
}
void uart_debug_task(void *pvParameters)
{
	uart_event_t event;
	static char         data_string[SYS_UART_MAX];
	static uint32_t     data_pointer = 0;
	uint32_t    ui32Temp0, ui32Temp1;
	char        * pchTemp;
	char        * dataRcv;
	char        chTemp;
	
	//
	for(;;)
	{
		if (xQueueReceive(spp_uart_queue, (void *)&event, (TickType_t)portMAX_DELAY))
		{
			switch (event.type)
			{
			case UART_DATA:
				//here processing data
				if(event.size)
				{
					//here should collect all recieved data in one line
					ui32Temp1 = event.size + 1;
					pchTemp = (char *)malloc(ui32Temp1);					
					if (pchTemp == NULL)
					{                   
						ESP_LOGE(GATTS_TABLE_TAG, "%s malloc.1 failed\n", __func__);	                    
						break;
					}
					memset(pchTemp, 0x0, ui32Temp1);
					uart_read_bytes(UART_NUM_1, pchTemp, event.size, portMAX_DELAY);
					for (ui32Temp0 = 0; ui32Temp0 < ui32Temp1; ui32Temp0++)
					{
						chTemp = pchTemp[ui32Temp0];
						if (((uint8_t)chTemp != 13) && ((uint8_t)chTemp != 10) && ((uint8_t)chTemp != 0))
						{
							data_string[data_pointer] = chTemp;
							if (data_pointer < SYS_UART_MAX) {data_pointer++; }					
						}
						else
						{
							if ((uint8_t)chTemp == 10)
							{						
								//here processing CMD being executed
								//CLOUD_process_CMD(&SIG_unit, data_string);
								//here collected string to queue
								//and restart
								dataRcv = (char *)malloc(data_pointer + 1);	
								if (dataRcv == NULL)
								{
									ESP_LOGE(GATTS_TABLE_TAG, "%s malloc.2 failed\n", __func__);	                    
									break;
								}
								memset(dataRcv, 0x0, data_pointer + 1);
								memcpy(dataRcv, data_string, data_pointer);
								if (UNIT_transmit_data(&SIG_unit,  dataRcv) != Cloud_CMD_good) 
								//if (xQueueSend(UNIT_output_queue, &dataRcv, 100*portTICK_PERIOD_MS)!= pdPASS)	///!!! switched to output
								{
									ESP_LOGE(GATTS_TABLE_TAG, "%s input queue add - failed\n", __func__);	
									free(dataRcv);
									break;
								}
								data_pointer = 0;
							}
						}
					}
					free(pchTemp);
				}
				break;
			default:
				break;				
			}
		}
	}
	vTaskDelete(NULL);
}
//---
void uart_sys_task(void *pvParameters)
{
	uart_event_t event;
	static char         data_string[SYS_UART_MAX];
	static uint32_t     data_pointer = 0;
	uint32_t    ui32Temp0, ui32Temp1;
	char        * pchTemp;
	char        * dataRcv;
	char        chTemp;
	
	//
	for(;;)
	{
		if (xQueueReceive(sys_uart_queue, (void *)&event, (TickType_t)portMAX_DELAY))
		{			
			switch (event.type)
			{
			case UART_DATA:
				//here processing data
				if(event.size)
				{
					//here should collect all recieved data in one line
					ui32Temp1 = event.size + 1;
					pchTemp = (char *)malloc(ui32Temp1);					
					if (pchTemp == NULL)
					{                   
						ESP_LOGE(GATTS_TABLE_TAG, "%s malloc.1 failed\n", __func__);	                    
						break;
					}
					memset(pchTemp, 0x0, ui32Temp1);					
					uart_read_bytes(UART_NUM_0, pchTemp, event.size, portMAX_DELAY);
					
					for (ui32Temp0 = 0; ui32Temp0 < ui32Temp1; ui32Temp0++)
					{
						chTemp = pchTemp[ui32Temp0];
						if (((uint8_t)chTemp != 13) && ((uint8_t)chTemp != 10) && ((uint8_t)chTemp != 0))
						{
							data_string[data_pointer] = chTemp;
							if (data_pointer < SYS_UART_MAX) {data_pointer++; }					
						}
						else
						{
							if ((uint8_t)chTemp == 10)
							{														
								dataRcv = (char *)malloc(data_pointer + 1);	
								if (dataRcv == NULL)
								{
									ESP_LOGE(GATTS_TABLE_TAG, "%s malloc.2 failed\n", __func__);	                    
									break;
								}								                 
								memset(dataRcv, 0x0, data_pointer + 1);
								memcpy(dataRcv, data_string, data_pointer);
								if (xQueueSend(UNIT_input_queue, &dataRcv, 100*portTICK_PERIOD_MS) != pdPASS)
								{
									ESP_LOGE(GATTS_TABLE_TAG, "%s input queue add - failed\n", __func__);	
									free(dataRcv);
									break;
								}																
								data_pointer = 0;
							}
						}
					}
					free(pchTemp);
				}
				break;
			default:
				break;				
			}
		}
	}
	vTaskDelete(NULL);
}
//---
static void spp_uart_init(void)
{
    uart_config_t uart_debug_config = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .rx_flow_ctrl_thresh = 122,
        .source_clk = UART_SCLK_APB,
    };
	uart_config_t uart_sys_config = {
		.baud_rate = 9600,
		.data_bits = UART_DATA_8_BITS,
		.parity = UART_PARITY_DISABLE,
		.stop_bits = UART_STOP_BITS_1,
		.flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
		.rx_flow_ctrl_thresh = 122,
		.source_clk = UART_SCLK_APB,
	};
    //Install UART driver, and get the queue.
    uart_driver_install(UART_NUM_1, 4096, 8192, 10,&spp_uart_queue,0);
    //Set UART parameters
    uart_param_config(UART_NUM_1, &uart_debug_config);
    //Set UART pins
    uart_set_pin(UART_NUM_1, UART_DEBUG_TXD, UART_DEBUG_RXD, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    xTaskCreate(uart_debug_task, "uTaskD", 4200, (void*)UART_NUM_1, 8, NULL);
	//---
	uart_driver_install(UART_NUM_0, 4096, 8192, 20, &sys_uart_queue, 0);
	//Set UART parameters
	uart_param_config(UART_NUM_0, &uart_sys_config);
	//Set UART pins
	uart_set_pin(UART_NUM_0, UART_SYS_TXD, UART_SYS_RXD, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
	xTaskCreate(uart_sys_task, "uTaskS", 4200, (void*)UART_NUM_0, 8, NULL);
}
//---
void BLE_recieve_task(void * arg)
{
	char * pQueue_data;
	char * pData;
	char		data_string[2048];
	uint32_t    ui32Temp0, ui32Temp1;
	char        chTemp;
	uint32_t    data_pointer = 0;
	//here we are going to recieve lines from 
	for (;;)
	{
		vTaskDelay(10 / portTICK_PERIOD_MS);
		//---
		if (xQueueReceive(system_queue, &pQueue_data, 0)) 
		{			
			ui32Temp1 = strlen(pQueue_data);
			//ESP_LOGI("BLE task>", " data %s", pQueue_data);
			for (ui32Temp0 = 0; ui32Temp0 < ui32Temp1; ui32Temp0++)
			{
				chTemp = (char)pQueue_data[ui32Temp0];
				if (((uint8_t)chTemp != 13) && ((uint8_t)chTemp != 10) && ((uint8_t)chTemp != 0))
				{
					data_string[data_pointer] = chTemp;
					if (data_pointer < SYS_UART_MAX) {data_pointer++; }					
				}
				else
				{
					if ((uint8_t)chTemp == 10)
					{												
						data_string[data_pointer] = 0;					
						
						//---
						// here analyze CC_input_queue
						SIG_unit.ui32HBTimer = HB_RELOAD;
						//
						if (eval_BQ(&CC_input_queue, data_string) != Present)
						{
							//---
							pData = malloc(data_pointer + 1);
							if (pData == NULL)
							{
								ESP_LOGI("BLE task>", " memmory allocation failed");
							}
							memcpy((void *)pData, (void *)data_string, data_pointer + 1);						
							if (push_BQ(&CC_input_queue, pData) != Ok)
							{							
								ESP_LOGI("BLE task>", " faied to add - queue full");
								free(pData);
							}
							else
							{
								//ESP_LOGI("BLE_input>", "%s", data_string);
							}
						}
						data_pointer = 0;
					}						
				}
			}
			free(pQueue_data);			
		}
		if (!is_connected)
		{
			data_pointer = 0;
			//here possibly reset command queue as well
			//queue reseting here? - 
		}
	}
	vTaskDelete(NULL);
}
//---
void system_task(void * arg)
{
	char * pQueue_data;		
	uint32_t   ui32Temp2;

	for (;;)
	{
		//--- cyclic process 1st part ---
		//cyclic_init();
		//--- end of cyclic 1st part ---
		vTaskDelay(100 / portTICK_PERIOD_MS);
		//---
		// connection WDT tick
		if (SIG_unit.ui32HBTimer > 0)
		{
			SIG_unit.ui32HBTimer--;
#ifdef SYS_DISABLE_HB_DISCONNECT
			SIG_unit.ui32HBTimer = HB_RELOAD;			
#endif			
		}
		else
		{			
			if (is_connected)
			{
				ESP_LOGI("SYS_TASK>", "Disconnect event initiated");				
				esp_ble_gap_disconnect(spp_remote_bda);								
			}
			SIG_unit.ui32HBTimer = HB_RELOAD;			
		}
		
		//---
		//checking for BLE events
		if (pop_BQ(&CC_input_queue, &pQueue_data) == Ok )
		{						
			ESP_LOGI("INPUT_FROMO_UI>", "%s", pQueue_data);
			CLOUD_process_CMD(&SIG_unit, (char *)pQueue_data);				
			free(pQueue_data);
		}		
		//--- next check output queue to BLE
		if(xQueueReceive(CC_output_queue, &pQueue_data, 0))
		{						
			ESP_LOGI("REPLY_TO_UI>", "%s", pQueue_data);
			BLE_send((char *)pQueue_data);			
			free(pQueue_data);
		}
		//--- next UART data queues
		//--- check input queue
		if(xQueueReceive(UNIT_input_queue, &pQueue_data, 0))
		{						
			ESP_LOGI("DATA_FROM_UNIT>", "%s", pQueue_data);
			//ESP_LOGI("DATA_FROM_UNIT>","sys uart queue left %d",uxQueueSpacesAvailable(sys_uart_queue));
			//ESP_LOGI("DATA_FROM_UNIT>", "debug uart queue left %d", uxQueueSpacesAvailable(spp_uart_queue));
			//ESP_LOGI("DATA_FROM_UNIT>", "free heap size left %d", esp_get_free_heap_size());
			UNIT_data_process(&SIG_unit, pQueue_data);
			free(pQueue_data);
		}		
		//--- check output queue
		
		if(xQueueReceive(UNIT_output_queue, &pQueue_data, 0))
		{
			//here if data from UART recieved?			
			ESP_LOGI("CMD_TO_UNIT>", "%s", pQueue_data);
			uart_write_bytes(UART_NUM_0, pQueue_data, strlen(pQueue_data));//uart_write_bytes(UART_NUM_0, pQueue_data, strlen(pQueue_data));
			free(pQueue_data);
		}		
		//--- cyclic task 2nd part ---		
		ui32Temp2 = CT_control_process();		
		//---
		//--- end off task
	}
	vTaskDelete(NULL);
}
static void system_init(void)
{
	gpio_config_t io_conf;
	//here uart init
	//system task init
	system_queue = xQueueCreate(10, sizeof(uint32_t));
	init_unit();
	
	io_conf.intr_type = GPIO_INTR_DISABLE;
	io_conf.mode = GPIO_MODE_OUTPUT;
	io_conf.pull_down_en = GPIO_PULLDOWN_ENABLE;
	io_conf.pull_up_en = GPIO_PULLUP_DISABLE;
	io_conf.pin_bit_mask = (((uint32_t)1<< GPIO_RTC_CE) | ((uint32_t)1 << GPIO_RTC_SCLK) | ((uint32_t)1 << GPIO_RTC_SDAT));
	gpio_config(&io_conf);
	gpio_set_level(GPIO_RTC_CE, 0);
	gpio_set_level(GPIO_RTC_SCLK, 0);
	gpio_set_level(GPIO_RTC_SDAT, 0);	
	xTaskCreate(system_task, "system_task", 5200, NULL, 8, NULL);	
	xTaskCreate(BLE_recieve_task, "BLE_recieve_task", 4200, NULL, 10, NULL);	
	//here analog
}

void spp_cmd_task(void * arg)
{
    uint8_t * cmd_id;

    for(;;)
    {
        vTaskDelay(50 / portTICK_PERIOD_MS);
        if(xQueueReceive(cmd_cmd_queue, &cmd_id, portMAX_DELAY)) 
        {
	        //ESP_LOGI(GATTS_TABLE_TAG, "%s %d\n", __func__, __LINE__);
	        esp_log_buffer_char(GATTS_TABLE_TAG,(char *)(cmd_id),strlen((char *)cmd_id));
            free(cmd_id);
        }
    }
    vTaskDelete(NULL);
}

static void spp_task_init(void)
{
    //spp_uart_init();

#ifdef SUPPORT_HEARTBEAT
    cmd_heartbeat_queue = xQueueCreate(10, sizeof(uint32_t));
    xTaskCreate(spp_heartbeat_task, "spp_heartbeat_task", 2048, NULL, 10, NULL);
#endif

    cmd_cmd_queue = xQueueCreate(10, sizeof(uint32_t));
    xTaskCreate(spp_cmd_task, "spp_cmd_task", 2048, NULL, 10, NULL);
}

static void gap_event_handler(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param)
{
    esp_err_t err;
#ifdef BLE_DEBUG_OUTPUT
    ESP_LOGI(GATTS_TABLE_TAG, "GAP_EVT, event %d\n", event);
#endif
    switch (event) 
	{
    case ESP_GAP_BLE_ADV_DATA_RAW_SET_COMPLETE_EVT:
        esp_ble_gap_start_advertising(&spp_adv_params);
        break;
    case ESP_GAP_BLE_ADV_START_COMPLETE_EVT:
        //advertising start complete event to indicate advertising start successfully or failed
        if((err = param->adv_start_cmpl.status) != ESP_BT_STATUS_SUCCESS) 
        {
#ifdef BLE_DEBUG_OUTPUT	        
            ESP_LOGE(GATTS_TABLE_TAG, "Advertising start failed: %s\n", esp_err_to_name(err));
#endif	        
        }
        break;
    default:
        break;
    }
}

static void gatts_profile_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param)
{
    esp_ble_gatts_cb_param_t *p_data = (esp_ble_gatts_cb_param_t *) param;
	char * buffer;
    uint8_t res = 0xff;
#ifdef BLE_DEBUG_OUTPUT
    ESP_LOGI(GATTS_TABLE_TAG, "event = %x\n",event);
#endif	
    switch (event) {
    	case ESP_GATTS_REG_EVT:
#ifdef  BLE_DEBUG_OUTPUT	    
    	    ESP_LOGI(GATTS_TABLE_TAG, "%s %d\n", __func__, __LINE__);
#endif	    
        	esp_ble_gap_set_device_name(SAMPLE_DEVICE_NAME);
#ifdef  BLE_DEBUG_OUTPUT
        	ESP_LOGI(GATTS_TABLE_TAG, "%s %d\n", __func__, __LINE__);
#endif	    
        	esp_ble_gap_config_adv_data_raw((uint8_t *)spp_adv_data, sizeof(spp_adv_data));
#ifdef  BLE_DEBUG_OUTPUT
        	ESP_LOGI(GATTS_TABLE_TAG, "%s %d\n", __func__, __LINE__);
#endif	    
        	esp_ble_gatts_create_attr_tab(spp_gatt_db, gatts_if, SPP_IDX_NB, SPP_SVC_INST_ID);
       	break;
    	case ESP_GATTS_READ_EVT:
            res = find_char_and_desr_index(p_data->read.handle);
            if(res == SPP_IDX_SPP_STATUS_VAL)
            {
                //TODO:client read the status characteristic
            }
       	 break;
    	case ESP_GATTS_WRITE_EVT: 
        {
    	    res = find_char_and_desr_index(p_data->write.handle);
            if(p_data->write.is_prep == false)
            {	            
	            //ESP_LOGI(GATTS_TABLE_TAG, "ESP_GATTS_WRITE_EVT : handle = %d\n", res);
                if(res == SPP_IDX_SPP_COMMAND_VAL)
                {	                
                    uint8_t * spp_cmd_buff = NULL;
                    spp_cmd_buff = (uint8_t *)malloc((spp_mtu_size - 3) * sizeof(uint8_t));
                    if(spp_cmd_buff == NULL)
                    {
	                    
                        ESP_LOGE(GATTS_TABLE_TAG, "%s malloc failed\n", __func__);
                        break;
                    }
                    memset(spp_cmd_buff,0x0,(spp_mtu_size - 3));
                    memcpy(spp_cmd_buff,p_data->write.value,p_data->write.len);
                    xQueueSend(cmd_cmd_queue,&spp_cmd_buff,10/portTICK_PERIOD_MS);
                }
	            else if(res == SPP_IDX_SPP_DATA_NTF_CFG)
	            {
                    if((p_data->write.len == 2)&&(p_data->write.value[0] == 0x01)&&(p_data->write.value[1] == 0x00))
                    {
                        enable_data_ntf = true;
                    }else if((p_data->write.len == 2)&&(p_data->write.value[0] == 0x00)&&(p_data->write.value[1] == 0x00))
                    {
                        enable_data_ntf = false;
                    }
                }
                else if(res == SPP_IDX_SPP_DATA_RECV_VAL)
                {
#ifdef SPP_DEBUG_MODE
                    esp_log_buffer_char(GATTS_TABLE_TAG,(char *)(p_data->write.value),p_data->write.len);
#else	               
	                //uart_write_bytes(UART_NUM_0, "kuku", 4);
	                //here we have recieved line - should put it in queue
	                //uart_write_bytes(UART_NUM_0, (char *)(p_data->write.value), p_data->write.len);
	                
	                buffer = malloc(p_data->write.len + 1);
	                memcpy(buffer, (char *)(p_data->write.value), p_data->write.len);
	                buffer[p_data->write.len] = (char)0;
	                //ESP_LOGI(GATTS_TABLE_TAG, "DATA : %s, %d\n", buffer, p_data->write.len);
	                xQueueSend(system_queue, &buffer, 0);
#endif
                }else
                {
                    //TODO:
                }
            }else if((p_data->write.is_prep == true)&&(res == SPP_IDX_SPP_DATA_RECV_VAL))
            {
                
	            //ESP_LOGI(GATTS_TABLE_TAG, "ESP_GATTS_PREP_WRITE_EVT : handle = %d\n", res);
            
                store_wr_buffer(p_data);
            }
      	 	break;
    	}
    	case ESP_GATTS_EXEC_WRITE_EVT:
        {
                  	    
	        //ESP_LOGI(GATTS_TABLE_TAG, "ESP_GATTS_EXEC_WRITE_EVT\n");
    	    if(p_data->exec_write.exec_write_flag)
    	    {
    	        //what does it doing - no idea so far
	    	    print_write_buffer();
    	        free_write_buffer();	    	    
    	    }
    	    break;
    	}
    	case ESP_GATTS_MTU_EVT:
    	    //spp_mtu_size = p_data->mtu.mtu;
    	    break;
    	case ESP_GATTS_CONF_EVT:
    	    break;
    	case ESP_GATTS_UNREG_EVT:
        	break;
    	case ESP_GATTS_DELETE_EVT:
        	break;
    	case ESP_GATTS_START_EVT:
        	break;
    	case ESP_GATTS_STOP_EVT:
        	break;
    	case ESP_GATTS_CONNECT_EVT:
			ESP_LOGI(GATTS_TABLE_TAG, "Connect event");
			//UNIT_send_data(&SIG_unit);
			SIG_unit.ui32HBTimer = HB_RELOAD;
    	    spp_conn_id = p_data->connect.conn_id;
    	    spp_gatts_if = gatts_if;
    	    is_connected = true;
			free_write_buffer();
    	    memcpy(&spp_remote_bda,&p_data->connect.remote_bda,sizeof(esp_bd_addr_t));
#ifdef SUPPORT_HEARTBEAT
    	    uint16_t cmd = 0;
            xQueueSend(cmd_heartbeat_queue,&cmd,10/portTICK_PERIOD_MS);
#endif
        	break;
    	case ESP_GATTS_DISCONNECT_EVT:
			ESP_LOGI(GATTS_TABLE_TAG, "Disconnect event, restarting advertising");
    	    is_connected = false;
    	    enable_data_ntf = false;
#ifdef SUPPORT_HEARTBEAT
    	    enable_heart_ntf = false;
    	    heartbeat_count_num = 0;
#endif
    	    esp_ble_gap_start_advertising(&spp_adv_params);
    	    break;
    	case ESP_GATTS_OPEN_EVT:
    	    break;
    	case ESP_GATTS_CANCEL_OPEN_EVT:
    	    break;
    	case ESP_GATTS_CLOSE_EVT:
    	    break;
    	case ESP_GATTS_LISTEN_EVT:
    	    break;
    	case ESP_GATTS_CONGEST_EVT:
    	    break;
    	case ESP_GATTS_CREAT_ATTR_TAB_EVT:
        {
#ifdef  BLE_DEBUG_OUTPUT  	        
    	    ESP_LOGI(GATTS_TABLE_TAG, "The number handle =%x\n",param->add_attr_tab.num_handle);
#endif	        
    	    if (param->add_attr_tab.status != ESP_GATT_OK)
    	    {
#ifdef  BLE_DEBUG_OUTPUT  	    	    
    	        ESP_LOGE(GATTS_TABLE_TAG, "Create attribute table failed, error code=0x%x", param->add_attr_tab.status);
#endif	    	    
    	    }
    	    else if (param->add_attr_tab.num_handle != SPP_IDX_NB)
    	    {
#ifdef  BLE_DEBUG_OUTPUT  	    	    
    	        ESP_LOGE(GATTS_TABLE_TAG, "Create attribute table abnormally, num_handle (%d) doesn't equal to HRS_IDX_NB(%d)", param->add_attr_tab.num_handle, SPP_IDX_NB);
#endif	    	    
    	    }
    	    else 
    	    {
    	        memcpy(spp_handle_table, param->add_attr_tab.handles, sizeof(spp_handle_table));
    	        esp_ble_gatts_start_service(spp_handle_table[SPP_IDX_SVC]);
    	    }
    	    break;
    	}
    	default:
    	    break;
    }
}
static void gatts_event_handler(esp_gatts_cb_event_t event, esp_gatt_if_t gatts_if, esp_ble_gatts_cb_param_t *param)
{
#ifdef  BLE_DEBUG_OUTPUT      
	ESP_LOGI(GATTS_TABLE_TAG, "EVT %d, gatts if %d\n", event, gatts_if);
#endif	
    /* If event is register event, store the gatts_if for each profile */
    if (event == ESP_GATTS_REG_EVT) 
    {
        if (param->reg.status == ESP_GATT_OK) 
        {
            spp_profile_tab[SPP_PROFILE_APP_IDX].gatts_if = gatts_if;
        } else 
        {
#ifdef  BLE_DEBUG_OUTPUT  	        
            ESP_LOGI(GATTS_TABLE_TAG, "Reg app failed, app_id %04x, status %d\n",param->reg.app_id, param->reg.status);
#endif	        
            return;
        }
    }

    do 
	{
        int idx;
        for (idx = 0; idx < SPP_PROFILE_NUM; idx++) 
        {
            if (gatts_if == ESP_GATT_IF_NONE || /* ESP_GATT_IF_NONE, not specify a certain gatt_if, need to call every profile cb function */
                    gatts_if == spp_profile_tab[idx].gatts_if) 
            {
                if (spp_profile_tab[idx].gatts_cb) 
                {
                    spp_profile_tab[idx].gatts_cb(event, gatts_if, param);
                }
            }
        }
    } while (0);
}

void app_main(void)
{
    esp_err_t ret;
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    //adc_oneshot_unit_handle_t adc1_handle;
    adc_oneshot_unit_init_cfg_t init_config1 = {
        .unit_id = ADC_UNIT_1,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };   
    // 2. --- ADC Channel Configuration ---
    adc_oneshot_chan_cfg_t config = {
        .bitwidth = ADC_BITWIDTH_DEFAULT, // Typically 12-bit for C3
        .atten = ADC_ATTEN_DB_0,         // Allows voltage up to ~2.5V - 3.3V
    };
	//--- initialize ADC
	ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_config1, &adc1_handle));
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, ADC_CHANNEL_3, &config));
	//--- Initialize NVS
    ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK( ret );

    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    //---
	// here start system UARTs and wait while first message from unit is recieved	
    spp_uart_init();
	system_init();
	ESP_LOGI("MAIN>", "Waiting from intial controller data...\n"); 	
	
	// here should send AT+LINKSTATUS=1
	UNIT_transmit_data(&SIG_unit, "AT+BLE=1");	
	UNIT_transmit_data(&SIG_unit, "AT+BLE=1");
	UNIT_transmit_data(&SIG_unit, "AT+LINKSTATUS=1");
	UNIT_transmit_data(&SIG_unit, "AT+WORKSTATUS");
	// here we are going to execute command
	// next send command implementing read of all registers.
	

	// here potentially have to initialize controller - this 
	// here we get a situation, when 
	//!!!
	//while (!(SIG_unit.system.ui32SYSTEM_state & wui_data_from_control_valid)) 
	//{
	    //here wait for closest communication from	
	//}	
	//!!!
	//---	
	init_bt_adv_data(spp_adv_data);
	init_aux_functions();
	//---	
    ret = esp_bt_controller_init(&bt_cfg);
	
    if (ret) 
    {	    
        ESP_LOGE(GATTS_TABLE_TAG, "%s enable controller failed: %s\n", __func__, esp_err_to_name(ret));    
        return;
    }
    
    ret = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    if (ret) 
    {	    
        ESP_LOGE(GATTS_TABLE_TAG, "%s enable controller failed: %s\n", __func__, esp_err_to_name(ret));
        return;
    }
    ESP_LOGI(GATTS_TABLE_TAG, "%s init bluetooth\n", __func__);	
    ret = esp_bluedroid_init();
    if (ret) 
    {	    
        ESP_LOGE(GATTS_TABLE_TAG, "%s init bluetooth failed: %s\n", __func__, esp_err_to_name(ret));
        return;
    }
    ret = esp_bluedroid_enable();
    if (ret) 
    {
        ESP_LOGE(GATTS_TABLE_TAG, "%s enable bluetooth failed: %s\n", __func__, esp_err_to_name(ret));	    
        return;
    }
	//esp_ble_tx_power_set()
#ifndef SYS_DISABLE_RF_POWER_LIMIT
	ret = esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, ESP_PWR_LVL_N12);
	if (ret) 
	{
		ESP_LOGE(GATTS_TABLE_TAG, "%s bluetooth power set failed: %s\n", __func__, esp_err_to_name(ret));	    
		return;
	}
#endif	
    esp_ble_gatts_register_callback(gatts_event_handler);
    esp_ble_gap_register_callback(gap_event_handler);
    esp_ble_gatts_app_register(ESP_SPP_APP_ID);

    spp_task_init();	
    return;
}
