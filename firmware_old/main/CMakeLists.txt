idf_component_register(
                    INCLUDE_DIRS "."
                    SRCS auxilary_devices.c basic_queue.c cloud_control.c main.c)
component_compile_definitions(SYS_DISABLE_HB_DISCONNECT_off SYS_DISABLE_RF_POWER_LIMIT_off)
