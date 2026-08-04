ALTER TABLE "stage_transition_projection" DROP CONSTRAINT "stage_transition_projection_valid_edge_check";--> statement-breakpoint
ALTER TABLE "stage_transition_projection" ADD CONSTRAINT "stage_transition_projection_valid_edge_check" CHECK ((
                ("stage_transition_projection"."previous_stage" = 'Drafted' and "stage_transition_projection"."current_stage" = 'Submitted')
                or ("stage_transition_projection"."previous_stage" = 'Submitted' and "stage_transition_projection"."current_stage" = 'Manager Approval')
                or ("stage_transition_projection"."previous_stage" = 'Manager Approval' and "stage_transition_projection"."current_stage" = 'AP Review')
                or ("stage_transition_projection"."previous_stage" = 'AP Review' and "stage_transition_projection"."current_stage" = 'Paid')
                or ("stage_transition_projection"."previous_stage" = 'Paid' and "stage_transition_projection"."current_stage" = 'Reconciled')
                or ("stage_transition_projection"."previous_stage" = 'Paid' and "stage_transition_projection"."current_stage" = 'AP Review')
                or ("stage_transition_projection"."previous_stage" = 'Manager Approval' and "stage_transition_projection"."current_stage" = 'Drafted')
                or ("stage_transition_projection"."previous_stage" = 'AP Review' and "stage_transition_projection"."current_stage" = 'Drafted')
            ));
